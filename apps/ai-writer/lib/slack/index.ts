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

import { Sentry } from '@/lib/observability/sentry';

import { isCloudRun } from '@/lib/utils/cloud-run';
import type { ScheduledRunSummary } from '../scheduled/summary';
import { missingSlackConfigKeys, readSlackConfig, type SlackConfig } from './config';
import { postSlackMessage } from './client';
import { buildPipelineMessage, type PipelineNotification, type SlackMessage } from './messages';
import { buildScheduledRunMessage, scheduledRunLinks } from './scheduled-run-message';

// 入口 (CLI / cron route) が使うものだけを公開する。部品は各モジュールから直接 import する
export {
  pipelineNotificationFromResult,
  type PipelineMode,
  type PipelineNotification,
} from './messages';

/**
 * 設定を読み、組み立てたメッセージを送る。**例外を投げない。**
 *
 * `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` が無ければ送らない (処理の失敗扱いにはしない)。
 * - ローカル: warn ログを 1 行出して skip する (op run を通さない実行は正常な使い方)
 * - Cloud Run: 注入漏れなので Sentry へ warning を出す。失敗通知が届かないこと自体に
 *   気づけるようにするため (warning はメール通知の対象外。Sentry の定期まとめで拾われる)
 */
async function sendToSlack(
  env: NodeJS.ProcessEnv,
  build: (config: SlackConfig) => { message: SlackMessage; channel: string }
): Promise<void> {
  try {
    const config = readSlackConfig(env);
    if (!config) {
      const missing = missingSlackConfigKeys(env).join(' / ');
      if (isCloudRun(env)) {
        console.error(`[Slack] ${missing} が未設定のため、通知を送れません`);
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
    const { message, channel } = build(config);
    await postSlackMessage({ token: config.token, channel }, message);
  } catch (error) {
    // 組み立て側の想定外の例外も呼び出し元へ伝播させない
    console.error(
      '[Slack] 通知の準備中にエラーが発生しました:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * パイプラインの結果を Slack へ通知する (CLI / cron route)。**例外を投げない。**
 * なお S5 (Scheduler 稼働) までは Service へ token を注入しないので、その間に cron 経路が失敗した
 * 場合は未設定の warning が出る
 */
export async function notifyPipelineResult(
  notification: PipelineNotification,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await sendToSlack(env, config => ({
    message: buildPipelineMessage(notification, config),
    channel: config.channel,
  }));
}

/**
 * 定期実行の 1 回分の結果を Slack へ 1 通送る。**例外を投げない。**
 *
 * PR か失敗がある回は本番系 (`SLACK_CHANNEL_ID`) にメンション付き、それ以外は開発系
 * (`SLACK_DEV_CHANNEL_ID`、無ければ本番系) にメンションなしで送る
 */
export async function notifyScheduledRun(
  summary: ScheduledRunSummary,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await sendToSlack(env, config => {
    const { message, attention } = buildScheduledRunMessage(summary, config, scheduledRunLinks(env));
    return { message, channel: attention ? config.channel : (config.devChannel ?? config.channel) };
  });
}
