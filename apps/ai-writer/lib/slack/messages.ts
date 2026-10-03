/**
 * 記事パイプラインの結果を Slack メッセージ (text + Block Kit) に組み立てる純粋関数群
 *
 * - 補間する値はすべて `&` `<` `>` をエスケープする。エラー文やソース URL に
 *   `<!channel>` が混ざると、ワークスペース全員に通知が飛ぶため
 * - top-level の `text` は blocks 使用時に「通知に表示される文字列」になる
 *   (https://docs.slack.dev/reference/methods/chat.postMessage) ので、
 *   要点とメンションを必ず入れる
 * - Block Kit の上限 (section text 3000 字 / fields 各 2000 字) に収まるよう切り詰める
 *
 * @module lib/slack/messages
 */

import type { SlackConfig } from './config';

export type PipelineOutcome = 'success' | 'skipped' | 'failure';
export type PipelineEntrypoint = 'cli' | 'cron';

export interface PipelineNotification {
  outcome: PipelineOutcome;
  entrypoint: PipelineEntrypoint;
  /** 記事 URL (CLI) または RSS フィード URL (cron) */
  sourceUrl: string;
  /** 実行モード (例: pr / dry-run / local / upload-images) */
  mode?: string;
  prUrl?: string;
  skipReason?: string;
  error?: string;
  workSlug?: string;
  postId?: string;
  /** CLI の `--log` で出力したログファイルのパス */
  logPath?: string;
  /** Cloud Run のリビジョン名 (`K_REVISION`) */
  revision?: string;
}

export interface SlackMessage {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

const ERROR_MAX_CHARS = 500;
const URL_MAX_CHARS = 500;
const FIELD_MAX_CHARS = 2000;

/** Slack の制御文字 (`&` `<` `>`) をエスケープする */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** max 文字を超えたら末尾を `…` にして切り詰める */
export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const OUTCOME_LABEL: Record<PipelineOutcome, string> = {
  success: '✅ 成功',
  skipped: '⏭️ スキップ',
  failure: '❌ 失敗',
};

const ENTRYPOINT_LABEL: Record<PipelineEntrypoint, string> = {
  cli: 'ローカル実走 (debug:mdx)',
  cron: 'Cloud Run (cron)',
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return truncate(url, 80);
  }
}

/** 値を安全に埋め込む (エスケープ + 切り詰め) */
function safe(value: string, max: number): string {
  return truncate(escapeSlackText(value), max);
}

/**
 * 通知内容から Slack メッセージを組み立てる。
 *
 * メンションは **失敗時かつ config.mentionUserId がある時だけ**付ける
 * (成功・スキップでは鳴らさない)。
 */
export function buildPipelineMessage(
  notification: PipelineNotification,
  config: Pick<SlackConfig, 'runtime' | 'mentionUserId'>
): SlackMessage {
  const envLabel = config.runtime === 'cloud-run' ? 'production' : 'local';
  const mention =
    notification.outcome === 'failure' && config.mentionUserId ? `<@${config.mentionUserId}> ` : '';

  const summary =
    `${mention}${OUTCOME_LABEL[notification.outcome]} [${envLabel}] 記事パイプライン` +
    ` (${safe(hostOf(notification.sourceUrl), 200)})`;

  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    { type: 'mrkdwn', text: `*入口*\n${ENTRYPOINT_LABEL[notification.entrypoint]}` },
    { type: 'mrkdwn', text: `*対象 URL*\n${safe(notification.sourceUrl, URL_MAX_CHARS)}` },
  ];
  if (notification.mode) {
    fields.push({ type: 'mrkdwn', text: `*モード*\n${safe(notification.mode, 100)}` });
  }
  if (notification.workSlug) {
    fields.push({ type: 'mrkdwn', text: `*作品*\n${safe(notification.workSlug, 200)}` });
  }
  if (notification.postId) {
    fields.push({ type: 'mrkdwn', text: `*Post ID*\n${safe(notification.postId, 100)}` });
  }

  const blocks: Array<Record<string, unknown>> = [
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
    {
      type: 'section',
      fields: fields.map(f => ({ ...f, text: truncate(f.text, FIELD_MAX_CHARS) })),
    },
  ];

  const detail = buildDetailText(notification);
  if (detail) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: detail } });
  }

  const contextItems: string[] = [];
  if (notification.logPath) contextItems.push(`ログ: ${safe(notification.logPath, 300)}`);
  if (notification.revision) contextItems.push(`revision: ${safe(notification.revision, 100)}`);
  if (contextItems.length > 0) {
    blocks.push({
      type: 'context',
      elements: contextItems.map(text => ({ type: 'mrkdwn', text })),
    });
  }

  return { text: summary, blocks };
}

function buildDetailText(notification: PipelineNotification): string | undefined {
  switch (notification.outcome) {
    case 'success':
      return notification.prUrl
        ? `*PR*\n${safe(notification.prUrl, URL_MAX_CHARS)}`
        : '*PR*\n作成していません (PR を作らないモード)';
    case 'skipped':
      return notification.skipReason
        ? `*理由*\n${safe(notification.skipReason, ERROR_MAX_CHARS)}`
        : undefined;
    case 'failure': {
      // コードブロックを途中で閉じさせないため、本文中の ``` を置き換える
      const error = (notification.error ?? '(エラー内容なし)').replace(/```/g, "'''");
      return `*エラー*\n\`\`\`${safe(error, ERROR_MAX_CHARS)}\`\`\``;
    }
  }
}

/** `ArticleGenerationMdxService.generateMdxFromRSS` の戻り値のうち通知に使う部分 */
export interface PipelineResultLike {
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
  prResult?: { prUrl?: string };
  details?: { workSlug?: string; postId?: string };
}

/**
 * パイプラインの戻り値を通知内容へ写す。
 *
 * ⚠️ スキップは `success: false, skipped: true` で返るため、**skipped を先に判定する**。
 * 逆にすると、公式 URL が無いだけの記事が「失敗」として通知される。
 */
export function pipelineNotificationFromResult(
  result: PipelineResultLike,
  context: Pick<PipelineNotification, 'entrypoint' | 'sourceUrl' | 'mode' | 'logPath' | 'revision'>
): PipelineNotification {
  const base = {
    ...context,
    workSlug: result.details?.workSlug,
    postId: result.details?.postId,
  };

  if (result.skipped) {
    return { ...base, outcome: 'skipped', skipReason: result.skipReason };
  }
  if (!result.success) {
    return { ...base, outcome: 'failure', error: result.error };
  }
  return { ...base, outcome: 'success', prUrl: result.prResult?.prUrl };
}
