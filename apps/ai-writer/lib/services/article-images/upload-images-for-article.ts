/**
 * 記事 1 本分の画像を上げ、アイキャッチを選ぶ (image-upload-r2 step、2026-10-13 BOSS 決定)
 *
 * - カテゴリ (メニュー・ノベルティ・グッズ) ごとに全件を上げる (枚数の上限なし。短辺の下限・縮小・WebP・分割は
 *   `processArticleImage`)
 * - アイキャッチは og:image → 本文の最初の横長の画像 (幅 / 高さ ≥ `eyecatch_landscape_ratio`) → 本文の最初の画像。
 *   候補を上げられなければ次の候補へ進む。og:image は元のまま、本文の画像から作るときは縮めた JPEG にする
 *   (`uploadEyecatchImage`)
 * - 複数のカテゴリに同じ画像があれば、先のカテゴリ (メニュー → ノベルティ → グッズ) にだけ載せる
 * - 品目ごとの画像 (代替テキストと品名の照合) を見出しの下に並べる形の MDX にする (`itemImageTags`)
 */
import type { ImageExtractionConfig } from '@/lib/types/subpage-detection';
import { articleImageTags } from './article-image-tag';
import { matchImagesToItems } from './match-item-images';
import {
  uploadArticleImages,
  uploadEyecatchImage,
  type ArticleImageRef,
  type ImageFetcher,
  type ImageStore,
  type SkippedImage,
  type UploadedArticleImage,
} from './upload-article-images';

export const IMAGE_CATEGORIES = ['menu', 'novelty', 'goods'] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];

export interface ArticleImageSources {
  ogImage: string | null;
  menu: string[];
  novelty: string[];
  goods: string[];
  /** 画像の URL → 代替テキスト */
  imageAlts: Record<string, string>;
}

export type EyecatchOrigin = 'og' | 'landscape' | 'first';

export interface EyecatchCandidate {
  sourceUrl: string;
  origin: EyecatchOrigin;
}

export interface ArticleImagesUpload {
  eyecatch?: ArticleImageRef & EyecatchCandidate;
  categories: Record<ImageCategory, UploadedArticleImage[]>;
  skipped: SkippedImage[];
  /** R2 に新しく置いた数 (既にあったものは数えない) */
  newObjects: number;
}

/**
 * アイキャッチの候補を、使う順に並べる (重複は除く)。本文の画像は上げた順 (メニュー → ノベルティ → グッズ)
 * で見て、寸法は元の画像のもの (分割の前) を使う
 */
export function eyecatchCandidates(
  ogImage: string | null,
  uploaded: readonly UploadedArticleImage[],
  landscapeRatio: number
): EyecatchCandidate[] {
  const candidates: EyecatchCandidate[] = [];
  if (ogImage) candidates.push({ sourceUrl: ogImage, origin: 'og' });
  const landscape = uploaded.find((image) => image.width / image.height >= landscapeRatio);
  if (landscape) candidates.push({ sourceUrl: landscape.sourceUrl, origin: 'landscape' });
  if (uploaded.length > 0) candidates.push({ sourceUrl: uploaded[0].sourceUrl, origin: 'first' });
  return candidates.filter((c, i) => candidates.findIndex((d) => d.sourceUrl === c.sourceUrl) === i);
}

/**
 * 画像を品目に振り分け、品目ごとの MDX (画像のタグを空行でつないだもの) と、どの品目にも付かなかった画像を返す。
 * 代替テキストは品名にする (公式の代替テキストには「2枚目_」のような接頭辞が付くため)。同じ品目に複数枚あれば番号を付ける
 */
export function itemImageTags(
  names: readonly string[],
  images: readonly UploadedArticleImage[]
): { tags: string[]; rest: UploadedArticleImage[]; matched: number } {
  const { byItem, rest } = matchImagesToItems([...names], [...images]);
  const tags = byItem.map((itemImages, index) =>
    itemImages
      .map((image, n) => articleImageTags(image.segments, itemImages.length > 1 ? `${names[index]} ${n + 1}` : names[index]))
      .join('\n\n')
  );
  return { tags, rest, matched: images.length - rest.length };
}

export interface UploadImagesForArticleOptions {
  folder: string;
  config: Pick<ImageExtractionConfig, 'min_short_side' | 'upload' | 'eyecatch_landscape_ratio'>;
  store: ImageStore | null;
  dryRun: boolean;
  fetcher?: ImageFetcher;
}

/**
 * 画像の設定が揃っているか。Templates が古いまま (`max_images_per_category` の頃) だと、全画像が
 * 「undefined を読めない」で個別に失敗し、記事が黙って画像なしになるため、最初にまとめて止める
 *
 * @throws 設定が欠けているとき
 */
export function assertImageUploadConfig(config: Partial<UploadImagesForArticleOptions['config']> | undefined): void {
  const missing = [
    typeof config?.min_short_side !== 'number' && 'min_short_side',
    typeof config?.eyecatch_landscape_ratio !== 'number' && 'eyecatch_landscape_ratio',
    typeof config?.upload?.max_width !== 'number' && 'upload',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `store-url-patterns.yaml の image_extraction に ${missing.join(' / ')} が無い (pnpm sync:templates で Templates を同期する)`
    );
  }
}

export async function uploadImagesForArticle(
  sources: ArticleImageSources,
  options: UploadImagesForArticleOptions
): Promise<ArticleImagesUpload> {
  assertImageUploadConfig(options.config);
  const result: ArticleImagesUpload = {
    categories: { menu: [], novelty: [], goods: [] },
    skipped: [],
    newObjects: 0,
  };

  const seen = new Set<string>();
  for (const category of IMAGE_CATEGORIES) {
    const images = sources[category]
      .filter((url) => !seen.has(url) && seen.add(url))
      .map((url) => ({ url, alt: sources.imageAlts[url] ?? null }));
    if (images.length === 0) continue;
    const uploaded = await uploadArticleImages(images, {
      folder: options.folder,
      config: options.config,
      store: options.store,
      dryRun: options.dryRun,
      fetcher: options.fetcher,
    });
    result.categories[category] = uploaded.uploaded;
    result.skipped.push(...uploaded.skipped);
    result.newObjects += uploaded.newObjects;
  }

  const bodyImages = IMAGE_CATEGORIES.flatMap((category) => result.categories[category]);
  for (const candidate of eyecatchCandidates(sources.ogImage, bodyImages, options.config.eyecatch_landscape_ratio)) {
    try {
      const eyecatch = await uploadEyecatchImage(candidate.sourceUrl, {
        folder: options.folder,
        store: options.store,
        dryRun: options.dryRun,
        fetcher: options.fetcher,
        derive: candidate.origin === 'og' ? undefined : options.config.upload,
      });
      if (eyecatch.uploaded) result.newObjects++;
      result.eyecatch = { url: eyecatch.url, width: eyecatch.width, height: eyecatch.height, ...candidate };
      break;
    } catch (error) {
      result.skipped.push({
        sourceUrl: candidate.sourceUrl,
        kind: 'failed',
        reason: `アイキャッチ (${candidate.origin}): ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return result;
}
