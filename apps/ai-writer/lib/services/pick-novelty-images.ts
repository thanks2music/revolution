/**
 * ノベルティの画像を、ノベルティ名が読めた会場の案内ページから選ぶ (Layer 1、2026-10-13)。
 *
 * ノベルティの下層ページが無いサイトでは、会場の案内ページの画像を使う。以前は「最初に画像のある会場のページ」を
 * 使っていたため、ヒロアカでは利用ガイド (/lp/guide) の手順の画像がノベルティの節に載った。下層ページの抽出で
 * ノベルティ名が読めたページだけを対象にし、その中で代替テキストが特典・ノベルティを示す画像
 * (`VenueNoveltyImages`、画像の抽出が作る) を使う。
 */
import type { VenueNoveltyImages } from '@/lib/services/category-image-extractor.service';
import type { SubpageFacts } from '@/lib/services/subpage-extraction.service';
import { pageUrlKey } from '@/lib/utils/url';

/** ノベルティ名が読めた会場のページのうち、画像の候補がある最初のページ。無ければ null */
export function pickNoveltyImages(
  candidates: readonly VenueNoveltyImages[],
  pages: readonly SubpageFacts[]
): VenueNoveltyImages | null {
  const withNovelties = new Set(
    pages
      .filter((page) => page.kind === 'venue' && (page.ノベルティ名?.length ?? 0) > 0)
      .map((page) => pageUrlKey(page.url))
  );
  return candidates.find((candidate) => candidate.images.length > 0 && withNovelties.has(pageUrlKey(candidate.url))) ?? null;
}
