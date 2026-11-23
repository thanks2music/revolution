/**
 * Vision を呼ばないサイト (2026-11-23 BOSS 決定)
 *
 * 品目が画像の中にしか無い公式ページのうち、Vision の費用に見合わない小規模なサイトは、画像を読まない。
 * 品名の無い節は、テンプレートの汎用の文章と画像だけで書く。一覧は Templates の `store-url-patterns.yaml` の
 * `vision_skip_hosts` (公式サイトのホスト)
 */

/** 大文字・小文字と先頭の `www.` を揃えたホスト */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, '');
}

/** 公式サイトの URL のホストが一覧にあるか。URL として読めなければ false */
export function skipsVision(officialUrl: string | null | undefined, hosts: unknown): boolean {
  // YAML の書き損じ (配列でない) で記事の生成を止めない。その時は一覧が無いのと同じ (Vision を呼ぶ)
  if (!officialUrl || !Array.isArray(hosts) || hosts.length === 0) return false;
  let host: string;
  try {
    host = normalizeHost(new URL(officialUrl).hostname);
  } catch {
    return false;
  }
  return hosts.some((entry) => typeof entry === 'string' && normalizeHost(entry) === host);
}
