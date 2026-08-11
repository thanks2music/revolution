/**
 * 外部サイトを取得するときの共通定数。
 *
 * ## なぜ切り出すか
 *
 * `html-extractor.ts` (抽出パイプライン) と `fetch-html.ts` (検証ツール) が
 * **同じタイムアウトと同じ User-Agent** を必要とする。検証側が違う値を使うと、
 * 「パイプラインが見た HTML」と「検証が見た HTML」が別物になり、
 * **不一致が出たときにどちらが誤りか判別できなくなる**。
 *
 * 以前は両ファイルに同じリテラルを書いていたため、片方だけ変えたときに
 * 気づけない構造だった (claude[bot] 指摘 2026-08-12)。
 *
 * @module lib/utils/http-constants
 */

/** HTML フェッチのタイムアウト (ms)。 */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * ブラウザライクな User-Agent。
 *
 * ⚠️ **キャンペーンサイトは bot をブロックすることがある。** 素の `fetch` の UA だと
 * ブロックページが 200 で返り、検証側では `.place` 0 件 →「LTR 系以外の構造」=
 * `unsupported` と誤って帰属される。抽出側と同じ UA を使うことが前提条件。
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
