/**
 * 記事の画像を取得・加工して R2 に上げる (2026-10-13 BOSS 決定)
 *
 * - 取得は SSRF ガード付き (`fetchImageSafely`)。加工は `processArticleImage` (短辺・縮小・WebP・分割)
 * - R2 のキーは**出力の中身のハッシュ**。同じ画像なら同じキーになり、R2 に既にあれば上げない
 *   (記事を更新しても、画像に差分が無ければ上げ直さない。Frontend は寸法を URL ごとに期限なしで保存するので、
 *   同じキーの中身を差し替えてはいけない — ハッシュの名前ならそれが起きない)
 * - 1 枚の失敗で記事を止めない (その画像を飛ばし、理由を返す)
 * - dry-run では取得と加工まで行い (寸法と分割が確かめられる)、R2 には触らない。URL は `[DRY RUN] …` にする
 */
import { createHash } from 'crypto';
import sharp from 'sharp';
import type { ImageExtractionConfig, ImageUploadConfig } from '@/lib/types/subpage-detection';
import { fetchImageSafely } from '@/lib/utils/safe-image-fetch';
import { processArticleImage, processEyecatchFallback } from './process-article-image';

/** 記事に載せる画像 1 枚 (R2 の URL と寸法) */
export interface ArticleImageRef {
  url: string;
  width: number;
  height: number;
}

/** 公式のページの画像 1 枚 (取得元の URL と代替テキスト) */
export interface SourceImage {
  url: string;
  alt: string | null;
}

/** 上げた画像 1 枚。縦長の画像は分割した片が segments に並ぶ (上から順) */
export interface UploadedArticleImage {
  sourceUrl: string;
  alt: string | null;
  /** 元の画像の寸法 (向きを反映した後) */
  width: number;
  height: number;
  segments: ArticleImageRef[];
}

export interface SkippedImage {
  sourceUrl: string;
  /** too_small = 短辺が下限未満 (アイコンなど。日常的に起きる) / failed = 取得・加工・アップロードの失敗 */
  kind: 'too_small' | 'failed';
  reason: string;
}

/** R2 への読み書き (テストで差し替えるため) */
export interface ImageStore {
  exists(key: string): Promise<boolean>;
  put(key: string, buffer: Buffer, contentType: string): Promise<void>;
  publicUrlFor(key: string): string;
}

export type ImageFetcher = (url: string) => Promise<{ buffer: Buffer; contentType: string | null }>;

/** 元の画像の取得の上限 (加工前。縮めて上げるので、5 MB を超える元画像も受け取る) */
const SOURCE_MAX_BYTES = 40 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 30_000;

const defaultFetcher: ImageFetcher = (url) =>
  fetchImageSafely(url, { maxBytes: SOURCE_MAX_BYTES, timeoutMs: SOURCE_TIMEOUT_MS });

/** 中身のハッシュのキー (`{folder}/{sha256 の先頭 32 桁}.{ext}`) */
export function contentKey(folder: string, buffer: Buffer, ext: string): string {
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 32);
  return `${folder}/${hash}.${ext}`;
}

interface UploadContext {
  store: ImageStore | null;
  dryRun: boolean;
}

/** キーに上げる (既にあれば上げない)。上げたか・既にあったかを返す */
async function putIfAbsent(
  key: string,
  buffer: Buffer,
  contentType: string,
  context: UploadContext
): Promise<{ url: string; uploaded: boolean }> {
  if (context.dryRun || !context.store) {
    return { url: `[DRY RUN] ${process.env.R2_PUBLIC_URL ?? ''}/${key}`, uploaded: false };
  }
  if (await context.store.exists(key)) return { url: context.store.publicUrlFor(key), uploaded: false };
  await context.store.put(key, buffer, contentType);
  return { url: context.store.publicUrlFor(key), uploaded: true };
}

export interface UploadArticleImagesOptions {
  folder: string;
  config: Pick<ImageExtractionConfig, 'min_short_side' | 'upload'>;
  store: ImageStore | null;
  dryRun: boolean;
  fetcher?: ImageFetcher;
}

/**
 * 画像を順に取得・加工して上げる (縦長の画像は展開すると大きいので、並列にしない)。
 * 返す順は元の順。短辺が足りない画像・失敗した画像は skipped に入れる
 */
export async function uploadArticleImages(
  images: SourceImage[],
  options: UploadArticleImagesOptions
): Promise<{ uploaded: UploadedArticleImage[]; skipped: SkippedImage[]; newObjects: number }> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const context: UploadContext = { store: options.store, dryRun: options.dryRun };
  const uploaded: UploadedArticleImage[] = [];
  const skipped: SkippedImage[] = [];
  let newObjects = 0;
  const seen = new Set<string>();

  for (const image of images) {
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    try {
      const { buffer } = await fetcher(image.url);
      const processed = await processArticleImage(buffer, options.config.upload, options.config.min_short_side);
      if (processed.kind === 'too_small') {
        skipped.push({ sourceUrl: image.url, kind: 'too_small', reason: `短辺が ${options.config.min_short_side}px 未満 (${processed.width}×${processed.height})` });
        continue;
      }
      const segments: ArticleImageRef[] = [];
      for (const segment of processed.segments) {
        const key = contentKey(options.folder, segment.buffer, 'webp');
        const result = await putIfAbsent(key, segment.buffer, 'image/webp', context);
        if (result.uploaded) newObjects++;
        segments.push({ url: result.url, width: segment.width, height: segment.height });
      }
      uploaded.push({ sourceUrl: image.url, alt: image.alt, width: processed.width, height: processed.height, segments });
    } catch (error) {
      skipped.push({ sourceUrl: image.url, kind: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { uploaded, skipped, newObjects };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/**
 * アイキャッチ (記事の冒頭・SNS の共有画像) を上げる。キーは中身のハッシュ (差分が無ければ上げない)。
 * - og:image (`derive` なし): SNS 向けに作られた画像なので、**形式も大きさも変えず**に上げ、寸法だけ測る
 * - 本文の画像から作るとき (`derive` あり): 縮めて、縦長なら上端の片だけを使い、JPEG にする
 *   (本文の画像は 1920×28300 のような縦長や数十 MB のものがあり、そのままでは SNS で読めない)
 *
 * @throws 取得・読み込みに失敗したとき、画像でないとき
 */
export async function uploadEyecatchImage(
  sourceUrl: string,
  options: { folder: string; store: ImageStore | null; dryRun: boolean; fetcher?: ImageFetcher; derive?: ImageUploadConfig }
): Promise<ArticleImageRef & { uploaded: boolean }> {
  const { buffer, contentType } = await (options.fetcher ?? defaultFetcher)(sourceUrl);
  const context = { store: options.store, dryRun: options.dryRun };
  if (options.derive) {
    const derived = await processEyecatchFallback(buffer, options.derive);
    const result = await putIfAbsent(contentKey(options.folder, derived.buffer, 'jpg'), derived.buffer, 'image/jpeg', context);
    return { url: result.url, width: derived.width, height: derived.height, uploaded: result.uploaded };
  }
  const metadata = await sharp(buffer, { autoOrient: true }).metadata();
  const { width, height } = metadata.autoOrient ?? metadata;
  if (!width || !height || !metadata.format) throw new Error('画像の大きさを読めない');
  const type = contentType?.split(';')[0].trim() ?? '';
  const ext = EXTENSIONS[type] ?? (metadata.format === 'jpeg' ? 'jpg' : metadata.format);
  const mime = EXTENSIONS[type] ? type : `image/${metadata.format}`;
  const result = await putIfAbsent(contentKey(options.folder, buffer, ext), buffer, mime, context);
  return { url: result.url, width, height, uploaded: result.uploaded };
}

/** R2StorageService を ImageStore として使う */
export function r2ImageStore(r2: {
  objectExists(key: string): Promise<boolean>;
  uploadImage(buffer: Buffer, options: { filename: string; contentType: string; customKey: string }): Promise<unknown>;
  publicUrlFor(key: string): string;
}): ImageStore {
  return {
    exists: (key) => r2.objectExists(key),
    put: async (key, buffer, contentType) => {
      await r2.uploadImage(buffer, { filename: key.split('/').pop() ?? key, contentType, customKey: key });
    },
    publicUrlFor: (key) => r2.publicUrlFor(key),
  };
}
