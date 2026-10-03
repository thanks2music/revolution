/**
 * Slack 通知 (bot token + chat.postMessage)
 *
 * 通知は**パイプラインの入口** (CLI `scripts/debug-mdx-url.ts` / cron route) から
 * 1 実行につき 1 通だけ送る。下位のライブラリ (create-mdx-pr 等) からは送らない
 * (入口でも送ると同じ失敗が 2 通届くため)。
 *
 * 運用ルール (チャンネルの振り分け・メンション・token の配布先) は
 * one-more-time/docs/operations/slack-notification-sop.md を参照。
 *
 * @module lib/slack
 */

import * as Sentry from '@sentry/nextjs';

import { isCloudRun, missingSlackConfigKeys, readSlackConfig } from './config';
import { postSlackMessage } from './client';
import { buildPipelineMessage, type PipelineNotification } from './messages';

// 入口 (CLI / cron route) が使うものだけを公開する。部品は各モジュールから直接 import する
export {
  pipelineNotificationFromResult,
  type PipelineMode,
  type PipelineNotification,
} from './messages';

/**
 * パイプラインの結果を Slack へ通知する。**例外を投げない。**
 *
 * `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` が無ければ送らない (パイプラインの失敗扱いにはしない)。
 * - ローカル: warn ログを 1 行出して skip する (op run を通さない実行は正常な使い方)
 * - Cloud Run: 注入漏れなので Sentry へ warning を出す。失敗通知が届かないこと自体に
 *   気づけるようにするため (warning はメール通知の対象外。Sentry の定期まとめで拾われる)。
 *   なお S5 (Scheduler 稼働) までは Cloud Run へ token を注入しないので、その間に
 *   cron 経路が失敗した場合もこの warning が出る
 */
export async function notifyPipelineResult(
  notification: PipelineNotification,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  try {
    const config = readSlackConfig(env);
    if (!config) {
      const missing = missingSlackConfigKeys(env).join(' / ');
      if (isCloudRun(env)) {
        console.error(`[Slack] ${missing} が未設定のため、失敗通知を送れません`);
        Sentry.captureMessage('Slack notification is not configured on Cloud Run', {
          level: 'warning',
          fingerprint: ['slack-config-missing'],
          extra: { missing },
        });
      } else {
        console.warn(`[Slack] ${missing} が未設定 (op:// のままを含む) のため通知をスキップします`);
      }
      return;
    }
    await postSlackMessage(config, buildPipelineMessage(notification, config));
  } catch (error) {
    // 組み立て側の想定外の例外も呼び出し元へ伝播させない
    console.error(
      '[Slack] 通知の準備中にエラーが発生しました:',
      error instanceof Error ? error.message : String(error)
    );
  }
}
