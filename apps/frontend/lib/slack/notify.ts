/**
 * 公開サイト (と、今後の管理アプリ) から Slack へ通知を送る口。
 *
 * ## 2 つのチャンネル
 *
 * | 送り先 | env のキー | メンション | 例 |
 * |---|---|---|---|
 * | `attention` (要対応) | `SLACK_ATTENTION_CHANNEL_ID` | `SLACK_MENTION_USER_ID` へ付ける | 通報、BOSS の確認待ちになった口コミ |
 * | `notice` (お知らせ) | `SLACK_NOTICE_CHANNEL_ID` | 付けない | 口コミの投稿・審査の結果、会員登録、いいね |
 *
 * token は `SLACK_BOT_TOKEN` (AI ライターと同じキー名)。チャンネルの名前は作る時に BOSS が決め、
 * ここにはキーだけを書く。メンションは `SLACK_MENTION_USER_ID` を設定した環境だけで付く
 * (Vercel では Production にだけ設定する。Preview やローカルで BOSS を鳴らさないため)。
 *
 * ## 呼び出し側の決まり
 *
 * - **例外を投げない。** 送れたら true、送らなかった・失敗したら false。ユーザーの操作は成功させる
 * - キーが未設定なら送らない。エラーにもログにもしない (ローカルや Preview では通知しないのが正常)
 * - 失敗は Sentry に warning で残す (エラーコードだけ。token と本文は出さない)
 * - 応答を遅らせないよう、Server Action などからは `after()` (next/server) の中で呼ぶ
 * - 外部から来た値 (表示名・本文など) は `@revolution/slack/text` で切り詰めてからエスケープする
 *
 * @module lib/slack/notify
 */

import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { presentEnvValue } from '@revolution/slack/env';
import { postSlackMessage, type SlackMessage } from '@revolution/slack/post-message';

export type SlackDestination = 'attention' | 'notice';

const CHANNEL_KEY: Record<SlackDestination, string> = {
  attention: 'SLACK_ATTENTION_CHANNEL_ID',
  notice: 'SLACK_NOTICE_CHANNEL_ID',
};

type SlackEnv = Record<string, string | undefined>;

export async function notifySlack(
  destination: SlackDestination,
  message: SlackMessage,
  env: SlackEnv = process.env,
): Promise<boolean> {
  let failureCode: string;
  try {
    const token = presentEnvValue(env.SLACK_BOT_TOKEN);
    const channel = presentEnvValue(env[CHANNEL_KEY[destination]]);
    if (!token || !channel) return false;

    const mentionUserId =
      destination === 'attention' ? presentEnvValue(env.SLACK_MENTION_USER_ID) : undefined;

    const result = await postSlackMessage(
      { token, channel },
      mentionUserId ? withMention(message, mentionUserId) : message,
    );
    if (result.ok) return true;
    failureCode = result.code;
  } catch {
    // 組み立ての想定外の例外も呼び出し元へ伝えない (postSlackMessage 自体は投げない)
    failureCode = 'unexpected_error';
  }

  // 記録は try の外で 1 回だけ行う (try の中だと、記録が投げた時に catch でもう一度記録する)
  reportFailure(destination, failureCode);
  return false;
}

/** Slack が 1 通に受け付ける blocks の上限 (https://docs.slack.dev/reference/methods/chat.postMessage) */
const MAX_BLOCKS = 50;

/**
 * 本文の先頭と blocks にメンションを置く。blocks があると、表示は blocks が使われ、本文 (`text`) は
 * 通知の代わりの文になるため、blocks の側にもメンションが要る。
 *
 * - blocks が上限未満: 先頭にメンションのブロックを足す
 * - blocks が上限: 足すと全体が `invalid_blocks` で拒まれるので、最初の mrkdwn の section の文の先頭に差し込む
 * - blocks が空: メンションのブロックだけにすると本文が隠れるので、本文にだけ置く
 */
function withMention(message: SlackMessage, userId: string): SlackMessage {
  const mention = `<@${userId}>`;
  return { text: `${mention} ${message.text}`, blocks: blocksWithMention(message.blocks, mention) };
}

type Block = Record<string, unknown>;

function blocksWithMention(blocks: Block[] | undefined, mention: string): Block[] | undefined {
  if (!blocks || blocks.length === 0) return blocks;
  if (blocks.length < MAX_BLOCKS) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: mention } }, ...blocks];
  }
  const index = blocks.findIndex(isMrkdwnSection);
  if (index === -1) return blocks;
  const section = blocks[index] as { text: { text: string } } & Block;
  const updated = { ...section, text: { ...section.text, text: `${mention} ${section.text.text}` } };
  return blocks.map((block, i) => (i === index ? updated : block));
}

function isMrkdwnSection(block: Block): boolean {
  const text = block.text as { type?: unknown; text?: unknown } | undefined;
  return block.type === 'section' && text?.type === 'mrkdwn' && typeof text.text === 'string';
}

/** 失敗を記録する。記録が失敗しても例外を外へ出さない (notifySlack は例外を投げない約束のため) */
function reportFailure(destination: SlackDestination, code: string): void {
  try {
    console.error(`[Slack] chat.postMessage failed (${destination}): ${code}`);
    // 通知が届かないこと自体は気づきにくいので残す。ユーザーの操作は成功しているので warning 止まり
    Sentry.captureMessage('Slack notification failed', {
      level: 'warning',
      fingerprint: ['slack-notification-failed', code],
      tags: { destination },
    });
  } catch {
    // 記録の手段が無いので、ここでは何もしない
  }
}
