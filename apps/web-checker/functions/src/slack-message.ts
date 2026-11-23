import type { SlackMessage } from '@revolution/slack/post-message';
import { escapeSlackText, truncate } from '@revolution/slack/text';

import type { Target } from './targets';

/** Block Kit の section の text の上限は 3000 字。見出しの分を残して切る */
const DIFF_MAX = 2800;
const CONTENT_MAX = 200;
const ERROR_MAX = 500;

type Block = Record<string, unknown>;

/** 外部由来の文字列を mrkdwn に埋め込める形にする (切ってからエスケープ。`text.ts` の決まり) */
function safe(value: string, max: number): string {
  return escapeSlackText(truncate(value, max));
}

/**
 * `<url|表示>` のリンク記法に入れる URL。`|` と `>` は記法を壊すのでパーセントエンコードする。
 * http(s) 以外は、リンクにせず文字として出す (javascript: などを踏ませない)。
 */
function link(url: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return label;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return label;
  const href = parsed.href.replace(/\|/g, '%7C').replace(/>/g, '%3E').replace(/</g, '%3C');
  return `<${href}|${label}>`;
}

function section(text: string): Block {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

export function formatJst(time: number): string {
  return new Date(time).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** 画面の履歴のページ (監視対象ごと) */
export function historyUrl(siteUrl: string, targetId: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/detail?targetId=${encodeURIComponent(targetId)}`;
}

export interface UpdateMessageInput {
  targetId: string;
  target: Pick<Target, 'title' | 'url'>;
  siteUrl: string;
  detectedAt: number;
  /** 前回の取得日時。最初のクロールでは `undefined` */
  previousAt?: number;
  /** 抜き出した部分のテキスト */
  content: string;
  /** 行の差分 (`formatLineDiff` の結果) */
  diff: string;
}

/** 更新検知 (最初のクロールでは「新規追加」) の通知 */
export function buildUpdateMessage(input: UpdateMessageInput): SlackMessage {
  const title = safe(input.target.title, 100);
  const heading =
    input.previousAt === undefined ? `[${title}] が新規追加されました` : `[${title}] で更新が検知されました`;

  const blocks: Block[] = [
    section(`*${link(input.target.url, heading)}*`),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*更新検知日時*\n${formatJst(input.detectedAt)}` },
        {
          type: 'mrkdwn',
          text: `*前回の更新日時*\n${input.previousAt === undefined ? '-' : formatJst(input.previousAt)}`,
        },
      ],
    },
    section(`*差分一覧*\n${link(historyUrl(input.siteUrl, input.targetId), '履歴を見る')}`),
    section(`*更新内容*\n${safe(input.content.trim(), CONTENT_MAX) || '-'}`),
  ];
  if (input.diff.trim()) blocks.push(section(`*差分*\n${safe(input.diff.trim(), DIFF_MAX)}`));

  return { text: heading, blocks };
}

/** 取得に失敗した時の通知 */
export function buildErrorMessage(
  target: Pick<Target, 'title' | 'url' | 'selector'>,
  siteUrl: string,
  error: unknown,
): SlackMessage {
  const heading = `[${safe(target.title, 100)}] でエラーが発生しました`;
  const message = error instanceof Error ? error.message : String(error);
  return {
    text: heading,
    blocks: [
      section(`*${link(target.url, heading)}*`),
      section(
        [
          `*URL*\n${safe(target.url, 300)}`,
          `*セレクタ*\n\`${safe(target.selector, 200)}\``,
          `*画面*\n${link(siteUrl, 'WEB チェッカー')}`,
          `*エラー内容*\n${safe(message, ERROR_MAX)}`,
        ].join('\n'),
      ),
    ],
  };
}

/** 抜き出す部分がページに無かった時の通知 */
export function buildNoContentMessage(
  target: Pick<Target, 'title' | 'url' | 'selector'>,
  siteUrl: string,
): SlackMessage {
  const heading = `[${safe(target.title, 100)}] でコンテンツが存在しませんでした`;
  return {
    text: heading,
    blocks: [
      section(`*${link(target.url, heading)}*`),
      section(
        [
          `*URL*\n${safe(target.url, 300)}`,
          `*セレクタ*\n\`${safe(target.selector, 200)}\``,
          `*画面*\n${link(siteUrl, 'WEB チェッカー')}`,
        ].join('\n'),
      ),
    ],
  };
}
