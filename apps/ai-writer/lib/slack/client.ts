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

/**
 * メッセージを送信する。成功なら true、失敗なら false (例外は投げない)。
 *
 * リトライはしない。タイムアウト後に Slack 側では受理されていた場合、
 * 再送すると二重投稿になるため。
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

    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;

    if (response.ok && body?.ok === true) {
      return true;
    }
    failureCode = body?.error ?? `http_${response.status}`;
  } catch (error) {
    failureCode =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 'timeout'
        : 'network_error';
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
