/**
 * Slack Web API (`chat.postMessage`) への送信
 *
 * **例外を投げない。** 呼び出し元はパイプラインの成否を伝える側で、通知の失敗で
 * 本来のエラーが差し替わってはいけない (旧 Incoming Webhook 実装で起きた事故。
 * revolution PR #304)。
 *
 * ⚠️ Web API はエラーでも HTTP 200 + `{ ok: false, error }` を返す。
 * HTTP ステータスだけでは失敗を検知できないため、本文の `ok` を判定する
 * (https://docs.slack.dev/reference/methods/chat.postMessage)。
 *
 * @module lib/slack/client
 */

import * as Sentry from '@sentry/nextjs';

import type { SlackConfig } from './config';
import type { SlackMessage } from './messages';

const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';
const DEFAULT_TIMEOUT_MS = 10_000;

/** `AbortSignal.timeout` による中断か (fetch 本体と本文の読み込みのどちらでも起きる) */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * メッセージを送信する。成功なら true、失敗なら false (例外は投げない)。
 *
 * リトライはしない。タイムアウト後に Slack 側では受理されていた場合、
 * 再送すると二重投稿になるため。rate limit (HTTP 429 + `Retry-After`) も
 * 意図して再送しない。上限は 1 チャンネルあたり約 1 通/秒で
 * (https://docs.slack.dev/apis/web-api/rate-limits)、1 実行 1 通の本通知では
 * 到達しない想定のため、到達した場合は失敗コード (本文に `error` があればその値、
 * 無ければ `http_429`) として可視化するに留める。
 */
export async function postSlackMessage(
  config: Pick<SlackConfig, 'token' | 'channel'>,
  message: SlackMessage,
  options: { timeoutMs?: number } = {}
): Promise<boolean> {
  let failureCode: string;

  try {
    const response = await fetch(POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        channel: config.channel,
        text: message.text,
        blocks: message.blocks,
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    let body: { ok?: boolean; error?: string } | null = null;
    try {
      body = (await response.json()) as { ok?: boolean; error?: string };
    } catch (error) {
      // 本文の読み込み中のタイムアウトは、下の catch で timeout として扱う
      if (isTimeout(error)) throw error;
      body = null; // JSON でない本文
    }

    if (response.ok && body?.ok === true) {
      return true;
    }
    // 本文が JSON でない (プロキシのエラーページ等) 場合は HTTP 200 でも失敗。
    // `http_200` だと成功と紛らわしいので区別する
    failureCode = body
      ? (body.error ?? `http_${response.status}`)
      : `invalid_response_http_${response.status}`;
  } catch (error) {
    failureCode = isTimeout(error) ? 'timeout' : 'network_error';
  }

  // 送信内容 (本文・token) はログに出さない。エラーコードだけを残す
  console.error(`[Slack] chat.postMessage failed: ${failureCode}`);

  // 通知が届いていないこと自体は気づきにくいので可視化する。業務は継続しているため
  // warning 止まり (Developer plan では warning = メール通知の対象外)。
  // ⚠️ `pnpm debug:mdx` (tsx) では Sentry が初期化されないため no-op。
  //    ローカル実走での気づきは上の console.error に依存する
  Sentry.captureMessage('Slack notification failed', {
    level: 'warning',
    fingerprint: ['slack-notification-failed', failureCode],
    extra: { error: failureCode },
  });

  return false;
}
