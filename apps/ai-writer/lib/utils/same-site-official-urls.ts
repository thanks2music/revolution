/**
 * 記事選別が返した公式 URL (`official_urls`) のうち、トップ (`primary_official_url`) と同じサイトの
 * ページを返す (Layer 1)。会場ごとの案内ページ (ヒロアカの `/lp/heroaca-cafe-s004` など) を
 * 下層ページの抽出で読むために使う (2026-10-12)。
 *
 * - 同じサイト = ホスト名が同じ (`www.` の有無は無視)
 * - トップ自身と、同じ URL の重複は除く (末尾の `/` の有無と `#` 以降は同じとみなす)
 * - URL として読めないもの、画像・PDF などページでないものは除く
 *
 * 記事選別の `official_urls` だけでなく、トップページのリンクも渡す (2026-10-12)。記事選別 (LLM) が
 * 会場の案内ページを返さない回があり、ヒロアカでノベルティが記事から消えたため。
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/#.*$/, '').replace(/\/+$/, '');
}

/** ページではないリンク (画像・PDF など) */
const NON_PAGE = /\.(?:jpe?g|png|gif|webp|svg|avif|pdf|zip|mp4|mp3)(?:[?#]|$)/i;

export function sameSiteOfficialUrls(primaryUrl: string, officialUrls: readonly string[] | undefined): string[] {
  const host = hostOf(primaryUrl);
  if (!host) return [];
  const seen = new Set([withoutTrailingSlash(primaryUrl)]);
  const result: string[] = [];
  for (const url of officialUrls ?? []) {
    const key = withoutTrailingSlash(url);
    if (hostOf(url) !== host || seen.has(key) || NON_PAGE.test(url)) continue;
    seen.add(key);
    result.push(url.replace(/#.*$/, ''));
  }
  return result;
}
