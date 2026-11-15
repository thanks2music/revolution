/**
 * The Slack message for one scheduled run (pure).
 *
 * One message per run, with one line per URL tried (decided 2026-11-15). A run that made a PR
 * or had a failure needs a person (a PR to review, something to fix), so it goes to the
 * production channel with a mention. Otherwise it goes to the dev channel without one.
 *
 * Values are made safe the same way as the pipeline message (`safe` in `messages.ts`).
 *
 * @module lib/slack/scheduled-run-message
 */
import {
  MAX_CONSECUTIVE_FAILURES,
  MAX_PRS_PER_RUN,
  MAX_TRIES_PER_RUN,
  prCountOf,
  RUN_TIME_BUDGET_MINUTES,
  type RunItem,
  type ScheduledRunSummary,
  type StopReason,
} from '../scheduled/summary';
import { toJstDateString } from '../utils/date';
import type { SlackConfig } from './config';
import { safe, type SlackMessage } from './messages';

const STOP_LABEL: Record<StopReason, string> = {
  'max-prs': `記事 PR が上限 (${MAX_PRS_PER_RUN} 本) に達したので止めました`,
  'max-tries': `試した候補が上限 (${MAX_TRIES_PER_RUN} 件) に達したので止めました`,
  'time-budget': `実行時間が ${RUN_TIME_BUDGET_MINUTES} 分を過ぎたので止めました`,
  'consecutive-failures': `${MAX_CONSECUTIVE_FAILURES} 件続けて失敗したので止めました (キーの失効や残高切れなど、全体の障害の可能性があります)`,
  error: '実行そのものが失敗したので止めました (試した URL の記録が残っていない可能性があります)',
};

const OUTCOME_ICON: Record<RunItem['outcome'], string> = {
  pr: '✅ PR',
  skipped: '⏭️ スキップ',
  unannounced: '⏳ 詳細未発表',
  failure: '❌ 失敗',
};

/** Something failed: a URL, or the run as a whole */
function hasFailure(summary: ScheduledRunSummary): boolean {
  return (
    summary.stopReason === 'consecutive-failures' ||
    summary.stopReason === 'error' ||
    summary.items.some(item => item.outcome === 'failure')
  );
}

/** A run that leaves something for a person to do */
export function needsAttention(summary: ScheduledRunSummary): boolean {
  return prCountOf(summary) > 0 || hasFailure(summary) || summary.feedErrors.length > 0;
}

function itemLine(item: RunItem, dryRun: boolean): string {
  // A dry run makes no PR; the article could be written
  const label = dryRun && item.outcome === 'pr' ? '✅ 記事にできる (dry-run)' : OUTCOME_ICON[item.outcome];
  const registered = item.registered ? ' (登録 URL)' : '';
  const lines = [`${label}${registered}  ${safe(item.title ?? item.url, 80)}`, safe(item.url, 300)];
  if (item.outcome === 'pr' && item.prUrl) lines.push(`PR: ${safe(item.prUrl, 300)}`);
  if (item.outcome !== 'pr' && item.reason) lines.push(`理由: ${safe(item.reason, 300)}`);
  if (item.givenUpReason) {
    lines.push(`🛑 ${safe(item.givenUpReason, 200)}`);
  } else if (item.nextAttemptAt) {
    lines.push(
      item.outcome === 'failure' ? '次の回に試し直します' : `次に試す日: ${toJstDateString(item.nextAttemptAt)}`,
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

  const text =
    `${mention}${hasFailure(summary) ? '❌' : '🗓️'} [${envLabel}]${summary.dryRun ? ' [dry-run]' : ''} 定期実行: ` +
    `${summary.dryRun ? '記事にできる' : 'PR'} ${count('pr')} 本・スキップ ${count('skipped')} 件・詳細未発表 ${count('unannounced')} 件・失敗 ${count('failure')} 件` +
    ` (候補 ${summary.candidateCount} 件のうち ${summary.items.length} 件を試した)`;

  const blocks: Array<Record<string, unknown>> = [{ type: 'section', text: { type: 'mrkdwn', text } }];

  const notes: string[] = [];
  if (summary.stopReason) notes.push(STOP_LABEL[summary.stopReason]);
  if (summary.error) notes.push(`エラー: ${safe(summary.error, 300)}`);
  for (const error of summary.feedErrors) notes.push(`読めなかったフィード: ${safe(error, 300)}`);
  if (summary.items.length === 0 && !summary.stopReason && summary.feedErrors.length === 0) {
    notes.push('試す候補がありませんでした');
  }
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
