/**
 * Slack Web API (`chat.postMessage`) への送信 (AI ライター)
 *
 * 送信そのもの (例外を投げない・本文の `ok` を見る・再送しない) は全アプリで共有する
 * `@revolution/slack/post-message` が行う。ここは AI ライターの記録の仕方 (console と、
 * tsx でも動く `lib/observability/sentry`) だけを持つ。
 *
 * **例外を投げない。** 呼び出し元はパイプラインの成否を伝える側で、通知の失敗で
 * 本来のエラーが差し替わってはいけない (旧 Incoming Webhook 実装で起きた事故。
 * revolution PR #304)。
 *
 * @module lib/slack/client
 */

import { postSlackMessage as post } from '@revolution/slack/post-message';

import { Sentry } from '@/lib/observability/sentry';

import type { SlackConfig } from './config';
import type { SlackMessage } from './messages';

/**
 * メッセージを送信する。成功なら true、失敗なら false (例外は投げない)。
 * 再送しない理由と失敗のコードの種類は `@revolution/slack/post-message` を参照
 */
export async function postSlackMessage(
  config: Pick<SlackConfig, 'token' | 'channel'>,
  message: SlackMessage
): Promise<boolean> {
  const result = await post({ token: config.token, channel: config.channel }, message);
  if (result.ok) return true;
  const failureCode = result.code;

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
