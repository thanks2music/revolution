/**
 * Slack通知モジュール
 *
 * Purpose:
 *   - GitHub PR作成エラー時のSlack通知
 *   - 重複PR検出時のSlack通知
 *   - エラー詳細のフォーマット済みメッセージ送信
 *
 * @module lib/slack/notifier
 * @see {@link /notes/02-backlog/super-mvp-scope.md} Task 6
 */

/**
 * Slack通知のタイプ
 */
export type SlackNotificationType = 'pr_failed' | 'duplicate_pr' | 'general_error';

/**
 * Slack通知パラメータ
 */
export interface SlackNotificationParams {
  type: SlackNotificationType;
  error: Error;
  context: {
    postId: string;
    workSlug: string;
    title: string;
    canonicalKey?: string;
    branchName?: string;
    filePath?: string;
  };
}

/**
 * Slack Block Kit メッセージペイロード
 */
interface SlackMessagePayload {
  text: string;
  blocks: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
    };
    fields?: Array<{
      type: string;
      text: string;
    }>;
  }>;
}

/**
 * エラータイプに応じた絵文字を取得
 */
function getErrorEmoji(type: SlackNotificationType): string {
  switch (type) {
    case 'pr_failed':
      return '🚨';
    case 'duplicate_pr':
      return '⚠️';
    case 'general_error':
      return '❌';
    default:
      return '🔴';
  }
}

/**
 * エラータイプに応じたタイトルを取得
 */
function getErrorTitle(type: SlackNotificationType): string {
  switch (type) {
    case 'pr_failed':
      return 'GitHub PR作成エラー';
    case 'duplicate_pr':
      return '重複PR検出';
    case 'general_error':
      return 'AI Writer実行エラー';
    default:
      return 'エラー発生';
  }
}

/**
 * Slack通知メッセージをフォーマット
 */
function formatSlackMessage(params: SlackNotificationParams): string {
  const { type, error, context } = params;
  const emoji = getErrorEmoji(type);
  const title = getErrorTitle(type);

  return `${emoji} *${title}*\n記事: ${context.title}\nエラー: ${error.message}`;
}

/**
 * Slack Block Kit形式の詳細メッセージを作成
 */
function formatDetailedMessage(params: SlackNotificationParams): SlackMessagePayload {
  const { type, error, context } = params;
  const emoji = getErrorEmoji(type);
  const title = getErrorTitle(type);

  const blocks: SlackMessagePayload['blocks'] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${title}`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*記事タイトル:*\n${context.title}`,
        },
        {
          type: 'mrkdwn',
          text: `*Post ID:*\n\`${context.postId}\``,
        },
        {
          type: 'mrkdwn',
          text: `*作品スラッグ:*\n\`${context.workSlug}\``,
        },
        {
          type: 'mrkdwn',
          text: `*エラータイプ:*\n\`${type}\``,
        },
      ],
    },
  ];

  // オプション情報を追加
  if (context.canonicalKey) {
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Canonical Key:*\n\`${context.canonicalKey}\``,
        },
      ],
    });
  }

  if (context.branchName) {
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*ブランチ名:*\n\`${context.branchName}\``,
        },
      ],
    });
  }

  if (context.filePath) {
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*ファイルパス:*\n\`${context.filePath}\``,
        },
      ],
    });
  }

  // エラー詳細セクション
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*エラーメッセージ:*\n\`\`\`${error.message}\`\`\``,
    },
  });

  // スタックトレース（最初の3行のみ）
  if (error.stack) {
    const stackLines = error.stack.split('\n').slice(0, 4).join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*スタックトレース:*\n\`\`\`${stackLines}\`\`\``,
      },
    });
  }

  return {
    text: formatSlackMessage(params),
    blocks,
  };
}

/**
 * Slack Webhook URL を取得
 *
 * 優先順位:
 * 1. 環境変数 SLACK_WEBHOOK_URL
 * 2. デフォルトWebhook URL
 */
function getSlackWebhookUrl(): string {
  const url = process.env.SLACK_WEBHOOK_URL || '';

  if (!url) {
    throw new Error('SLACK webhook URL is not configured. Set SLACK_WEBHOOK_URL');
  }

  return url;
}

/**
 * Slack通知を送信
 *
 * @description
 * GitHub PR作成エラーや重複PR検出時にSlackへ通知を送信します。
 * Block Kit形式で整形されたメッセージを送信します。
 *
 * @param {SlackNotificationParams} params - 通知パラメータ
 * @returns {Promise<void>}
 *
 * @example
 * ```typescript
 * await sendSlackNotification({
 *   type: 'pr_failed',
 *   error: new Error('GitHub API rate limit exceeded'),
 *   context: {
 *     postId: '01kaek3mh9',
 *     workSlug: 'sample-work',
 *     title: '作品名×店舗名2025',
 *     branchName: 'content/mdx-sample-work-01kaek3mh9',
 *     filePath: 'content/collabo-cafe/sample-work/01kaek3mh9.mdx'
 *   }
 * });
 * ```
 *
 * @throws {Error} Slack API呼び出しエラー（ただしログ出力のみで例外は再スローしない）
 */
export async function sendSlackNotification(params: SlackNotificationParams): Promise<void> {
  const webhookUrl = getSlackWebhookUrl();

  // Webhook URLが未設定の場合は警告のみ
  if (!webhookUrl) {
    console.warn('[Slack Notifier] SLACK_WEBHOOK_URL is not configured. Skipping notification.');
    return;
  }

  try {
    console.log(`[Slack Notifier] Sending notification: ${params.type}`);

    const payload = formatDetailedMessage(params);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Slack API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    console.log('[Slack Notifier] Notification sent successfully');
  } catch (error) {
    // Slack通知エラーは致命的ではないのでログ出力のみ
    console.error('[Slack Notifier] Failed to send notification:', error);
    if (error instanceof Error) {
      console.error('  Message:', error.message);
    }
    // 例外は再スローしない（通知失敗がメイン処理を止めないように）
  }
}

/**
 * 簡易的なテキスト通知を送信（デバッグ用）
 *
 * @param {string} message - 送信するメッセージ
 * @returns {Promise<void>}
 *
 * @example
 * ```typescript
 * await sendSimpleSlackMessage('Task 6 テスト: PR作成成功');
 * ```
 */
export async function sendSimpleSlackMessage(message: string): Promise<void> {
  const webhookUrl = getSlackWebhookUrl();

  if (!webhookUrl) {
    console.warn('[Slack Notifier] SLACK_WEBHOOK_URL is not configured. Skipping message.');
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: message }),
    });
  } catch (error) {
    console.error('[Slack Notifier] Failed to send simple message:', error);
  }
}
