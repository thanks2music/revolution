/**
 * 検証スクリプト用の HTML 取得。
 *
 * ## なぜ専用の関数を置くか
 *
 * `fetch(url).then((r) => r.text())` は **HTTP のエラー応答でも resolve する**。
 * 404 ページの HTML がそのまま「正解データの入力」になり、`.place` が 0 件だった結果が
 * 「LTR 系以外のサイト構造」という**別の原因に化ける**。実際に検証中、URL の打ち間違いが
 * サイト構造の問題として報告される経路になっていた。
 *
 * 失敗帰属の精度を守るため、**取得に失敗したら loud に落とす**。
 *
 * @module lib/utils/fetch-html
 */

/**
 * HTML を取得する。HTTP ステータスが 2xx でなければ throw する。
 *
 * @param url 取得先
 * @throws ステータスが 2xx でない場合、または取得自体に失敗した場合
 */
export async function fetchHtmlOrThrow(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `HTML の取得に失敗しました: HTTP ${response.status} ${response.statusText} (${url})`
    );
  }
  return response.text();
}
