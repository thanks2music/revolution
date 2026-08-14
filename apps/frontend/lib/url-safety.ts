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
 * ## 使用箇所は 3 つで rule-of-3 を満たしている
 *
 * `EventFactCard` (記事) / 企画ページ / 開催詳細ページ の 3 箇所。
 * 加えて **セキュリティ判定が場所ごとに微妙に違う状態を作らない**ことが
 * 共通化の主目的でもある (片方だけ緩い正規表現になっても気づけない)。
 */

/**
 * `http(s)` スキームの URL だけを許可する。
 *
 * `javascript:` / `data:` / `vbscript:` などを弾く。相対 URL も false を返す
 * (本関数は**外部リンク用**であり、サイト内リンクは Next.js の `Link` を使う)。
 *
 * ## 型ガード (`url is string`) にしている理由
 *
 * 単なる `boolean` を返すと、呼び出し側で `null` が絞り込まれず
 * `href={url!}` のような **non-null assertion が必要になる**。assertion は
 * 「人間が正しさを保証する」宣言であり、コンパイラの検査を外す。
 *
 * 型ガードにすれば `if (isSafeHttpUrl(x))` の中で `x: string` に絞り込まれ、
 * **コンパイラが保証する**形になる。オプショナルな URL を描画するページは
 * 今後も増えるので、最初のページでこの形を確立しておく
 * (PR #303 レビュー指摘: 「この pattern は今後コピペされる」)。
 */
export function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}
