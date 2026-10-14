/**
 * 記事の画像を取得・加工して R2 に上げる (2026-10-13 BOSS 決定)
 *
 * - 取得は SSRF ガード付き (`fetchImageSafely`)。加工は `processArticleImage` (短辺・縮小・WebP・分割)
 * - R2 のキーは**出力の中身のハッシュ**。同じ画像なら同じキーになり、R2 に既にあれば上げない
 *   (記事を更新しても、画像に差分が無ければ上げ直さない。Frontend は寸法を URL ごとに期限なしで保存するので、
 *   同じキーの中身を差し替えてはいけない — ハッシュの名前ならそれが起きない)
 * - 1 枚の失敗で記事を止めない (その画像を飛ばし、理由を返す)
 * - store が null なら dry-run: 取得と加工まで行い (寸法と分割が確かめられる)、R2 には触らない。URL は `[DRY RUN] …`
 */
import { createHash } from 'crypto';
import type { ImageExtractionConfig, ImageUploadConfig } from '@/lib/types/subpage-detection';
import { fetchImageSafely } from '@/lib/utils/safe-image-fetch';
import { processArticleImage, processEyecatchFallback, readImageInfo } from './process-article-image';

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
  /** prefix で始まるキーの一覧 */
  listKeys(prefix: string): Promise<string[]>;
  put(key: string, buffer: Buffer, contentType: string): Promise<void>;
  publicUrlFor(key: string): string;
}

export type ImageFetcher = (url: string) => Promise<{ buffer: Buffer; contentType: string | null }>;

/** 元の画像の取得の上限 (加工前。縮めて上げるので、5 MB を超える元画像も受け取る) */
const SOURCE_MAX_BYTES = 40 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 30_000;

export const defaultFetcher: ImageFetcher = (url) =>
  fetchImageSafely(url, { maxBytes: SOURCE_MAX_BYTES, timeoutMs: SOURCE_TIMEOUT_MS });

/** 中身のハッシュのキー (`{folder}/{sha256 の先頭 32 桁}.{ext}`) */
export function contentKey(folder: string, buffer: Buffer, ext: string): string {
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 32);
  return `${folder}/${hash}.${ext}`;
}

/** 記事 1 本のフォルダへの書き込み。キーが既にあれば上げない */
export interface FolderWriter {
  put(buffer: Buffer, ext: string, contentType: string): Promise<{ url: string; uploaded: boolean }>;
}

/**
 * フォルダへの書き込み口を作る。既にあるキーは、最初の書き込みのときに一覧で 1 回だけ読む
 * (画像ごとに有無を問い合わせると、100 枚の記事で 100 回の往復になる)。一覧に漏れがあっても
 * (1,000 件を超えるなど)、同じ中身を同じキーに上げ直すだけで害はない。store が null なら dry-run
 */
export function folderWriter(store: ImageStore | null, folder: string): FolderWriter {
  let existing: Promise<Set<string>> | undefined;
  /** 上げている途中のキー (同じ中身の片を並列に上げても、R2 に置くのは 1 回にする) */
  const inFlight = new Map<string, Promise<void>>();
  return {
    async put(buffer, ext, contentType) {
      const key = contentKey(folder, buffer, ext);
      if (!store) return { url: `[DRY RUN] ${process.env.R2_PUBLIC_URL ?? ''}/${key}`, uploaded: false };
      // 一覧の失敗は覚えない (覚えると、このフォルダへの以後の書き込みがすべて失敗する)
      existing ??= store.listKeys(`${folder}/`).then(
        (keys) => new Set(keys),
        (error) => {
          existing = undefined;
          throw error;
        }
      );
      const keys = await existing;
      const pending = inFlight.get(key);
      // 同じ中身を先に上げている側が失敗したら、待っていた側も同じ例外で失敗させる (その画像は skipped になる。
      // 同じ R2 に続けて書いても同じ理由で失敗する見込みが高いので、ここでは再試行しない)
      if (pending) {
        await pending;
        return { url: store.publicUrlFor(key), uploaded: false };
      }
      if (keys.has(key)) return { url: store.publicUrlFor(key), uploaded: false };
      const upload = store.put(key, buffer, contentType);
      inFlight.set(key, upload);
      try {
        await upload;
      } finally {
        inFlight.delete(key);
      }
      keys.add(key);
      return { url: store.publicUrlFor(key), uploaded: true };
    },
  };
}

export interface UploadArticleImagesOptions {
  writer: FolderWriter;
  config: Pick<ImageExtractionConfig, 'min_short_side' | 'upload'>;
  fetcher?: ImageFetcher;
}

/**
 * 画像を順に取得・加工して上げる (縦長の画像は展開すると大きいので、画像どうしは並列にしない。
 * 1 枚の片は並列に上げる)。返す順は元の順。短辺が足りない画像・失敗した画像は skipped に入れる
 */
export async function uploadArticleImages(
  images: SourceImage[],
  options: UploadArticleImagesOptions
): Promise<{ uploaded: UploadedArticleImage[]; skipped: SkippedImage[]; newObjects: number }> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const uploaded: UploadedArticleImage[] = [];
  const skipped: SkippedImage[] = [];
  let newObjects = 0;

  for (const image of images) {
    try {
      const { buffer } = await fetcher(image.url);
      const processed = await processArticleImage(buffer, options.config.upload, options.config.min_short_side);
      if (processed.kind === 'too_small') {
        skipped.push({
          sourceUrl: image.url,
          kind: 'too_small',
          reason: `短辺が ${options.config.min_short_side}px 未満 (${processed.width}×${processed.height})`,
        });
        continue;
      }
      const results = await Promise.all(
        processed.segments.map((segment) => options.writer.put(segment.buffer, 'webp', 'image/webp'))
      );
      newObjects += results.filter((result) => result.uploaded).length;
      uploaded.push({
        sourceUrl: image.url,
        alt: image.alt,
        width: processed.width,
        height: processed.height,
        segments: results.map((result, index) => ({
          url: result.url,
          width: processed.segments[index].width,
          height: processed.segments[index].height,
        })),
      });
    } catch (error) {
      skipped.push({ sourceUrl: image.url, kind: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { uploaded, skipped, newObjects };
}

/** sharp の形式名 → 拡張子と Content-Type (sharp は AVIF を heif と報告する) */
const FORMATS: Record<string, [ext: string, contentType: string]> = {
  jpeg: ['jpg', 'image/jpeg'],
  png: ['png', 'image/png'],
  webp: ['webp', 'image/webp'],
  gif: ['gif', 'image/gif'],
  heif: ['avif', 'image/avif'],
};

/**
 * アイキャッチ (記事の冒頭・SNS の共有画像) を上げる。キーは中身のハッシュ (差分が無ければ上げない)。
 * - og:image (`fromBody` なし): SNS 向けに作られた画像なので、**形式も大きさも変えず**に上げ、寸法だけ測る
 *   (公式サイトが公開している画像なので、アニメーションや EXIF も意図して残す)。
 *   ただし JPEG / PNG / WebP / GIF / AVIF 以外 (SVG はスクリプトを含められる) と、`max_bytes` を超えるものは作り直す
 * - 本文の画像から作るとき (`fromBody`): 必ず作り直す
 * - 作り直し: 幅を max_width まで縮め、縦長なら上端の片だけを使い、JPEG にする
 *   (本文の画像は 1920×28300 のような縦長や数十 MB のものがあり、そのままでは SNS で読めない)
 *
 * @throws 取得・読み込みに失敗したとき、画像でないとき
 */
export async function uploadEyecatchImage(
  sourceUrl: string,
  options: { writer: FolderWriter; config: ImageUploadConfig; fromBody?: boolean; fetcher?: ImageFetcher }
): Promise<ArticleImageRef & { uploaded: boolean }> {
  const { buffer } = await (options.fetcher ?? defaultFetcher)(sourceUrl);
  const info = await readImageInfo(buffer);
  const format = FORMATS[info.format];
  if (!options.fromBody && format && buffer.length <= options.config.max_bytes) {
    const result = await options.writer.put(buffer, format[0], format[1]);
    return { url: result.url, width: info.width, height: info.height, uploaded: result.uploaded };
  }
  const derived = await processEyecatchFallback(buffer, options.config);
  const result = await options.writer.put(derived.buffer, 'jpg', 'image/jpeg');
  return { url: result.url, width: derived.width, height: derived.height, uploaded: result.uploaded };
}

/** R2StorageService を ImageStore として使う */
export function r2ImageStore(r2: {
  listObjects(prefix: string): Promise<string[]>;
  uploadImage(buffer: Buffer, options: { filename: string; contentType: string; customKey: string }): Promise<unknown>;
  getPublicUrl(key: string): string;
}): ImageStore {
  return {
    listKeys: (prefix) => r2.listObjects(prefix),
    put: async (key, buffer, contentType) => {
      await r2.uploadImage(buffer, { filename: key.split('/').pop() ?? key, contentType, customKey: key });
    },
    publicUrlFor: (key) => r2.getPublicUrl(key),
  };
}
