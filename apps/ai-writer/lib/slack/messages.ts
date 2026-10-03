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

// 切り詰めはエスケープ前に行う。エスケープで最大 5 倍 (`&` → `&amp;`) に伸びても
// Block Kit の上限 (fields 各 2000 字 / section 3000 字) に収まる長さにしてある
const ERROR_MAX_CHARS = 500;
const URL_MAX_CHARS = 380;

/** Slack の制御文字 (`&` `<` `>`) をエスケープする */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * max 文字を超えたら末尾を `…` にして切り詰める。
 * コードポイント単位で数える (UTF-16 単位で切ると絵文字のサロゲートペアが割れて文字化けする)
 */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
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

/**
 * token らしき文字列を伏せる。
 *
 * エラー文 (SDK / API の message) や URL のクエリに秘密値が混ざっても、Slack
 * (無料プランでも 1 年残る) に載せないための多層防御。誤検知で伏せすぎても
 * 通知の意味は失われないため、広めに取る
 */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, // PEM 秘密鍵
  /https:\/\/hooks\.slack\.com\/[^\s"'<>]+/g, // Slack Incoming Webhook URL
  /\b(?:xox[abeoprs]|xapp)-[A-Za-z0-9-]{8,}/g, // Slack token / app-level token
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic (sk-ant-…)
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub token
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bsntrys_[A-Za-z0-9_=+/-]{16,}/g, // Sentry organization token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, // Authorization ヘッダ
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT (Supabase の key など)
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
}

/**
 * 値を安全に埋め込む (伏せ字 → 切り詰め → エスケープ)。
 * エスケープの後で切ると `&amp;` の途中で切れて表示が崩れるため、切ってからエスケープする
 */
function safe(value: string, max: number): string {
  return escapeSlackText(truncate(redactSecrets(value), max));
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
    { type: 'section', fields },
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
      if (notification.prUrl) return `*PR*\n${safe(notification.prUrl, URL_MAX_CHARS)}`;
      // PR を作るモード (mode = pr) なのに URL が無いのは想定外。成功扱いのまま気づけるようにする
      return notification.mode === 'pr'
        ? '*PR*\n⚠️ PR の URL を取得できませんでした (GitHub を確認してください)'
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
