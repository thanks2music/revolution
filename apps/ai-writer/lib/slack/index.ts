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

import { readSlackConfig } from './config';
import { postSlackMessage } from './client';
import { buildPipelineMessage, type PipelineNotification } from './messages';

export { readSlackConfig, type SlackConfig, type SlackRuntime } from './config';
export { postSlackMessage } from './client';
export {
  buildPipelineMessage,
  escapeSlackText,
  pipelineNotificationFromResult,
  type PipelineEntrypoint,
  type PipelineNotification,
  type PipelineOutcome,
  type PipelineResultLike,
  type SlackMessage,
} from './messages';

/**
 * パイプラインの結果を Slack へ通知する。**例外を投げない。**
 *
 * `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` が無ければ何もしない (失敗扱いにしない)。
 * Cloud Run へは S5 (Scheduler 稼働) まで token を注入しないため、
 * cron 経路は現時点では warn ログを 1 行出して skip する。
 */
export async function notifyPipelineResult(
  notification: PipelineNotification,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  try {
    const config = readSlackConfig(env);
    if (!config) {
      console.warn('[Slack] SLACK_BOT_TOKEN / SLACK_CHANNEL_ID が未設定のため通知をスキップします');
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
