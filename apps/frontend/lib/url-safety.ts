/**
 * 外部由来 URL を `href` / `src` に出す前の安全判定。
 *
 * ## なぜ必要か
 *
 * `official_url` は **スクレイピングした第三者 HTML から LLM が抽出した値**で、
 * 記事 frontmatter (`EventFactCard`) と Postgres (`events.official_url`) の
 * 両方に入る。どちらの経路にも**スキーム制限が無い**ことを実測で確認した
 * (2026-08-14、PR #302 のレビュー指摘を検証):
 *
 * | 層 | 検証内容 | `javascript:alert(1)` |
 * |---|---|---|
 * | zod `z.string().url()` | URL としてパースできるか | **通過** |
 * | DB CHECK `events_official_url_not_blank` | 空白でないか | **通過** |
 *
 * `z.string().url()` は `javascript:` / `data:` / `vbscript:` をすべて受理する
 * (URL 仕様上これらは妥当な URL であるため)。よって**描画側で弾く**。
 *
 * ## 本来の直し先
 *
 * 書き込み境界 (zod スキーマ) でスキームを制限するのが根本対応で、そちらは
 * 別途起票する。本ユーティリティは多層防御の外側であり、内側を省く理由には
 * ならない。
 *
 * ## rule-of-3 より一貫性を優先している
 *
 * 使用箇所は現時点で 2 つ (`EventFactCard` / 開催詳細ページ) で、DRY の
 * 「3 つで抽象化」には届かない。それでも共通化するのは、**セキュリティ判定が
 * 場所ごとに微妙に違う状態を作らない**ことのほうが重要なため。片方だけ
 * 緩い正規表現になっても気づけない。
 */

/**
 * `http(s)` スキームの URL だけを許可する。
 *
 * `javascript:` / `data:` / `vbscript:` などを弾く。相対 URL も false を返す
 * (本関数は**外部リンク用**であり、サイト内リンクは Next.js の `Link` を使う)。
 */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}
