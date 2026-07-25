/**
 * URL 正規化ユーティリティ (Layer 1 純粋関数)
 *
 * Sprint C-β P14: `collabo-cafe.com` origin から抽出された URL に付与される
 * UTM トラッキングパラメータ (`utm_source`, `utm_medium`, `utm_campaign`,
 * `utm_id` など) を剥がすための純関数。extraction 経路で外部 HTML から
 * utm 付き URL が MDX に流し込まれるケースに対応する。
 *
 * 設計原則:
 * - `URLSearchParams` API による query-param 単位の正確な操作
 *   (regex 置換だと `?utm_source=...&ref=abc` の `ref=abc` を欠落させるリスク)
 * - `utm_*` prefix の全パラメータを剥がす (Google Analytics 標準 6 種 +
 *   collabo-cafe.com 独自 `utm_id` 変種を包括)
 * - 非 utm クエリパラメータは保持 (`ref=`, `sig=`, `page=` 等)
 * - Fragment (`#section`) は保持
 * - 相対 URL / パース不能 URL は無変更で返す (safe fallback)
 * - null / undefined / 空文字は空文字を返す (呼び出し側での分岐削減)
 * - Idempotent: 既に clean な URL に対して再適用しても同じ結果
 *
 * 副次的な挙動 (byte-identical でない点):
 * - 返却 URL は `URL`/`URLSearchParams` 経由で構築されるため、生き残った非 utm
 *   パラメータの encoding は WHATWG URL normalization に従って再構築される
 *   (例: `?a=b c` (raw space) が `?a=b+c` に正規化されうる)。UTM 除去用途では
 *   下流の consumer が normalized URL を受け入れる前提のため無害だが、
 *   非 utm パラメータの byte-for-byte 保持が必要な文脈では別関数を用意する必要がある。
 */
export function stripUtmFromUrl(url: string | null | undefined): string {
  if (!url) return '';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const keysToDelete: string[] = [];
  parsed.searchParams.forEach((_, key) => {
    if (key.toLowerCase().startsWith('utm_')) {
      keysToDelete.push(key);
    }
  });

  if (keysToDelete.length === 0) return url;

  keysToDelete.forEach((key) => parsed.searchParams.delete(key));

  const remainingSearch = parsed.searchParams.toString();
  parsed.search = remainingSearch ? '?' + remainingSearch : '';
  return parsed.toString();
}
