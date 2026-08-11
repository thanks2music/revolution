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

/** 取得のタイムアウト (ms)。`html-extractor.ts` の `FETCH_TIMEOUT_MS` と同値。 */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * ブラウザライクな User-Agent。
 *
 * ⚠️ **キャンペーンサイトは bot をブロックすることがある。** 素の `fetch` の UA だと
 * ブロックページが 200 で返り、`.place` が 0 件 →「LTR 系以外の構造」= `unsupported`
 * と誤って帰属される。本モジュールは抽出パイプラインが実際に見ている HTML と
 * 同じものを取りたいので、`html-extractor.ts` と同じ UA を使う。
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * HTML を取得する。HTTP ステータスが 2xx でなければ throw する。
 *
 * タイムアウトと UA を明示するのは**失敗帰属のため**。無応答やブロックページを
 * 「サイト構造が違う」と読み違えないよう、取得段階の失敗は取得段階で落とす。
 *
 * @param url 取得先
 * @throws ステータスが 2xx でない場合、タイムアウトした場合、取得自体に失敗した場合
 */
export async function fetchHtmlOrThrow(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(
        `HTML の取得に失敗しました: HTTP ${response.status} ${response.statusText} (${url})`
      );
    }
    return await response.text();
  } catch (error) {
    // タイムアウトは「サイト構造が違う」ではなく「取得できなかった」と分かる文言にする
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`HTML の取得がタイムアウトしました (${FETCH_TIMEOUT_MS}ms): ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
