/**
 * The Slack message for one scheduled run (pure).
 *
 * One message per run, with one line per URL tried (decided 2026-11-15). A run that made a PR
 * or had a failure needs a person (a PR to review, something to fix), so it goes to the
 * production channel with a mention. Otherwise it goes to the dev channel without one.
 *
 * Values are made safe the same way as the pipeline message (`messages.ts`):
 * redact secrets, truncate, then escape.
 *
 * @module lib/slack/scheduled-run-message
 */
import type { RunItem, ScheduledRunSummary, StopReason } from '../scheduled/run';
import type { SlackConfig } from './config';
import { escapeSlackText, redactSecrets, truncate, type SlackMessage } from './messages';

function safe(value: string, max: number): string {
  return escapeSlackText(truncate(redactSecrets(value), max));
}

/** `YYYY-MM-DD` of the day in Japan */
function jstDay(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const STOP_LABEL: Record<StopReason, string> = {
  'max-prs': '記事 PR が上限 (5 本) に達したので止めました',
  'max-tries': '試した候補が上限 (15 件) に達したので止めました',
  'time-budget': '実行時間が 90 分を過ぎたので止めました',
  'consecutive-failures':
    '3 件続けて失敗したので止めました (キーの失効や残高切れなど、全体の障害の可能性があります)',
};

const OUTCOME_ICON: Record<RunItem['outcome'], string> = {
  pr: '✅ PR',
  skipped: '⏭️ スキップ',
  unannounced: '⏳ 詳細未発表',
  failure: '❌ 失敗',
};

/** A run that leaves something for a person to do */
export function needsAttention(summary: ScheduledRunSummary): boolean {
  return (
    summary.prCount > 0 ||
    summary.items.some(item => item.outcome === 'failure') ||
    summary.stopReason === 'consecutive-failures' ||
    summary.feedErrors.length > 0
  );
}

function itemLine(item: RunItem, dryRun: boolean): string {
  // A dry run makes no PR; the article could be written
  const label = dryRun && item.outcome === 'pr' ? '✅ 記事にできる (dry-run)' : OUTCOME_ICON[item.outcome];
  const head = `${label}  ${safe(item.title ?? item.url, 80)}`;
  const lines = [head, safe(item.url, 300)];
  if (item.outcome === 'pr' && item.prUrl) lines.push(`PR: ${safe(item.prUrl, 300)}`);
  if (item.outcome !== 'pr' && item.reason) lines.push(`理由: ${safe(item.reason, 300)}`);
  if (item.givenUpReason) {
    lines.push(`🛑 ${safe(item.givenUpReason, 200)}`);
  } else if (item.nextAttemptAt) {
    lines.push(
      item.outcome === 'failure'
        ? '次の回に試し直します'
        : `次に試す日: ${jstDay(item.nextAttemptAt)}`,
    );
  }
  return lines.join('\n');
}

export function buildScheduledRunMessage(
  summary: ScheduledRunSummary,
  config: Pick<SlackConfig, 'runtime' | 'mentionUserId'>,
): { message: SlackMessage; attention: boolean } {
  const attention = needsAttention(summary);
  const mention = attention && config.mentionUserId ? `<@${config.mentionUserId}> ` : '';
  const envLabel = config.runtime === 'cloud-run' ? 'production' : 'local';
  const count = (outcome: RunItem['outcome']) => summary.items.filter(item => item.outcome === outcome).length;
  const icon = summary.stopReason === 'consecutive-failures' || count('failure') > 0 ? '❌' : '🗓️';

  const text =
    `${mention}${icon} [${envLabel}]${summary.dryRun ? ' [dry-run]' : ''} 定期実行: ` +
    `${summary.dryRun ? '記事にできる' : 'PR'} ${summary.prCount} 本・スキップ ${count('skipped')} 件・詳細未発表 ${count('unannounced')} 件・失敗 ${count('failure')} 件` +
    ` (候補 ${summary.candidateCount} 件のうち ${summary.items.length} 件を試した)`;

  const blocks: Array<Record<string, unknown>> = [{ type: 'section', text: { type: 'mrkdwn', text } }];

  const notes: string[] = [];
  if (summary.stopReason) notes.push(STOP_LABEL[summary.stopReason]);
  for (const error of summary.feedErrors) notes.push(`読めなかったフィード: ${safe(error, 300)}`);
  if (summary.items.length === 0 && summary.feedErrors.length === 0) notes.push('試す候補がありませんでした');
  if (notes.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: notes.join('\n') } });
  }

  // One section per URL keeps each well under the 3000-character limit (at most 15 + 3 blocks,
  // under the 50-block limit)
  for (const item of summary.items) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: itemLine(item, summary.dryRun) } });
  }

  const minutes = Math.round((summary.finishedAt.getTime() - summary.startedAt.getTime()) / 60000);
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `所要 ${minutes} 分` }] });

  return { message: { text, blocks }, attention };
}
