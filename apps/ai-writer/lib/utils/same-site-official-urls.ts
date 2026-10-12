/**
 * 記事選別が返した公式 URL (`official_urls`) のうち、トップ (`primary_official_url`) と同じサイトの
 * ページを返す (Layer 1)。会場ごとの案内ページ (ヒロアカの `/lp/heroaca-cafe-s004` など) を
 * 下層ページの抽出で読むために使う (2026-10-12)。
 *
 * - 同じサイト = ホスト名が同じ (`www.` の有無は無視)
 * - トップ自身と、同じ URL の重複は除く (末尾の `/` の有無は同じとみなす)
 * - URL として読めないものは除く
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function sameSiteOfficialUrls(primaryUrl: string, officialUrls: readonly string[] | undefined): string[] {
  const host = hostOf(primaryUrl);
  if (!host) return [];
  const seen = new Set([withoutTrailingSlash(primaryUrl)]);
  const result: string[] = [];
  for (const url of officialUrls ?? []) {
    const key = withoutTrailingSlash(url);
    if (hostOf(url) !== host || seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}
