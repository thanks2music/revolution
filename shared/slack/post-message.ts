/**
 * Slack Web API (`chat.postMessage`) への送信。全アプリで共有する。
 *
 * - **例外を投げない。** 通知はユーザーの操作やパイプラインの成否を伝える側で、通知の失敗で
 *   本来の処理を失敗させてはいけない (旧 Incoming Webhook の実装で、通知の失敗が本来のエラーを
 *   差し替えた事故がある。revolution PR #304)
 * - **本文の `ok` を見る。** Web API はエラーでも HTTP 200 + `{ ok: false, error }` を返すため、
 *   HTTP のステータスだけでは失敗に気づけない
 *   (https://docs.slack.dev/reference/methods/chat.postMessage)
 * - **再送しない。** 時間切れの後に Slack 側では受理されていた場合、再送すると二重投稿になる。
 *   rate limit (HTTP 429) も再送しない。上限は 1 チャンネルあたり約 1 通/秒で
 *   (https://docs.slack.dev/apis/web-api/rate-limits)、1 つの出来事に 1 通の通知では当たらない想定
 *
 * ログと Sentry への記録はアプリごとに道具が違うので、ここでは行わず、失敗のコードを返す。
 * 呼び出し側は、コードだけを記録すること (token と本文はログに出さない)。
 *
 * 外部の依存を持たない (fetch だけで書く)。AI ライターの Docker イメージが、この package の
 * `node_modules` を個別にコピーしなくて済むようにするため (`apps/ai-writer/Dockerfile`)。
 *
 * @module @revolution/slack/post-message
 */

const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';
const TIMEOUT_MS = 10_000;

export interface SlackTarget {
  token: string;
  channel: string;
}

export interface SlackMessage {
  /** 通知の本文 (blocks があれば、通知の画面と検索に使われる代わりの文) */
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

/**
 * 送信の結果。失敗の `code` は、Slack の `error` (例: `channel_not_found`)、
 * `http_<ステータス>`、`invalid_response_http_<ステータス>` (本文が JSON でない)、
 * `timeout`、`network_error` のどれか
 */
export type SlackPostResult = { ok: true } | { ok: false; code: string };

/**
 * `AbortSignal.timeout` による中断か (fetch 本体と本文の読み込みのどちらでも起きる)。
 * `instanceof Error` では見ない。`DOMException` は実行環境によって別の realm の `Error` を
 * 継承していて (jest の node 環境など)、`instanceof` が偽になるため
 */
function isTimeout(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === 'TimeoutError' || name === 'AbortError';
}

export async function postSlackMessage(
  target: SlackTarget,
  message: SlackMessage,
): Promise<SlackPostResult> {
  try {
    const response = await fetch(POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify({
        channel: target.channel,
        text: message.text,
        blocks: message.blocks,
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = (await response.json().catch((error: unknown) => {
      // 本文の読み込み中の時間切れは、下の catch で timeout として扱う
      if (isTimeout(error)) throw error;
      return null; // JSON でない本文
    })) as { ok?: boolean; error?: string } | null;

    if (response.ok && body?.ok === true) return { ok: true };

    // 本文が JSON でない (プロキシのエラーページなど) 場合は、HTTP 200 でも失敗。
    // `http_200` だと成功と紛らわしいので区別する
    const code = body
      ? (body.error ?? `http_${response.status}`)
      : `invalid_response_http_${response.status}`;
    return { ok: false, code };
  } catch (error) {
    return { ok: false, code: isTimeout(error) ? 'timeout' : 'network_error' };
  }
}
