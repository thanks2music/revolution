/**
 * ノベルティの画像を、ノベルティ名が読めた会場の案内ページから選ぶ (Layer 1、2026-10-13)。
 *
 * ノベルティの下層ページが無いサイトでは、会場の案内ページの画像を使う。以前は「最初に画像のある会場のページ」を
 * 使っていたため、ヒロアカでは利用ガイド (/lp/guide) の手順の画像がノベルティの節に載った。下層ページの抽出で
 * ノベルティ名が読めたページだけを対象にし、その中で代替テキストが特典・ノベルティを示す画像
 * (`VenueNoveltyImages`、画像の抽出が作る) を使う。
 */
import type { CategoryImages, VenueNoveltyImages } from '@/lib/services/category-image-extractor.service';
import type { SubpageFacts } from '@/lib/services/subpage-extraction.service';
import { pageUrlKey } from '@/lib/utils/url';

/** ノベルティ名が読めた会場のページの URL (照合用のキー)。ノベルティの画像と「この記事のポイント」のノベルティの行が同じ基準で使う */
export function venueUrlsWithNovelties(pages: readonly SubpageFacts[]): Set<string> {
  return new Set(
    pages.filter((page) => page.kind === 'venue' && (page.ノベルティ名?.length ?? 0) > 0).map((page) => pageUrlKey(page.url))
  );
}

/** ノベルティ名が読めた会場のページのうち、画像の候補がある最初のページ。無ければ null */
export function pickNoveltyImages(
  candidates: readonly VenueNoveltyImages[],
  pages: readonly SubpageFacts[]
): VenueNoveltyImages | null {
  const withNovelties = venueUrlsWithNovelties(pages);
  return candidates.find((candidate) => candidate.images.length > 0 && withNovelties.has(pageUrlKey(candidate.url))) ?? null;
}

/**
 * ノベルティの画像がまだ無ければ、`pickNoveltyImages` で選んだ画像を入れた新しい `CategoryImages` を返す
 * (`sources.novelty` と `all` も更新する)。選べなければ、または既にノベルティの画像があれば、元のまま返す。
 * `picked` はログ用 (選ばなかったときは null)
 */
export function withNoveltyImagesFromVenues(
  categoryImages: CategoryImages,
  pages: readonly SubpageFacts[]
): { categoryImages: CategoryImages; picked: VenueNoveltyImages | null } {
  if (categoryImages.novelty.length > 0) return { categoryImages, picked: null };
  const picked = pickNoveltyImages(categoryImages.venueNoveltyImages, pages);
  if (!picked) return { categoryImages, picked: null };
  return {
    categoryImages: {
      ...categoryImages,
      novelty: picked.images,
      sources: { ...categoryImages.sources, novelty: picked.url },
      all: Array.from(new Set([...categoryImages.all, ...picked.images])),
    },
    picked,
  };
}
