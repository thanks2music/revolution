/**
 * Layer 1: the Slack message for one scheduled run (one message per run, decided 2026-11-15).
 */
import { describe, expect, it } from '@jest/globals';

import type { ScheduledRunSummary } from '@/lib/scheduled/run';
import { buildScheduledRunMessage, needsAttention } from '@/lib/slack/scheduled-run-message';

const CLOUD = { runtime: 'cloud-run' as const, mentionUserId: 'U0000000001' };

const summary = (overrides: Partial<ScheduledRunSummary> = {}): ScheduledRunSummary => ({
  dryRun: false,
  startedAt: new Date('2026-11-15T01:05:00Z'),
  finishedAt: new Date('2026-11-15T01:47:00Z'),
  items: [],
  prCount: 0,
  candidateCount: 0,
  feedErrors: [],
  ...overrides,
});

const text = (message: { blocks: Array<Record<string, unknown>> }) => JSON.stringify(message.blocks);

describe('needsAttention', () => {
  it('a run with only skips and unannounced events needs no one', () => {
    expect(
      needsAttention(
        summary({
          items: [
            { url: 'u1', source: 'rss', outcome: 'skipped' },
            { url: 'u2', source: 'rss', outcome: 'unannounced' },
          ],
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ['a PR', summary({ prCount: 1, items: [{ url: 'u', source: 'rss', outcome: 'pr' }] })],
    ['a failure', summary({ items: [{ url: 'u', source: 'rss', outcome: 'failure' }] })],
    ['an unreadable feed', summary({ feedErrors: ['コラボカフェ: 503'] })],
  ])('%s needs a person', (_, value) => {
    expect(needsAttention(value)).toBe(true);
  });
});

describe('buildScheduledRunMessage', () => {
  it('mentions only when a person is needed', () => {
    const quiet = buildScheduledRunMessage(summary({ items: [{ url: 'u', source: 'rss', outcome: 'skipped' }] }), CLOUD);
    expect(quiet.attention).toBe(false);
    expect(quiet.message.text).not.toContain('<@');

    const loud = buildScheduledRunMessage(summary({ items: [{ url: 'u', source: 'rss', outcome: 'failure', reason: 'x' }] }), CLOUD);
    expect(loud.attention).toBe(true);
    expect(loud.message.text.startsWith('<@U0000000001> ❌ [production]')).toBe(true);
  });

  it('counts each outcome in the summary line and marks a dry run', () => {
    const { message } = buildScheduledRunMessage(
      summary({
        dryRun: true,
        prCount: 1,
        candidateCount: 7,
        items: [
          { url: 'u1', source: 'rss', outcome: 'pr', prUrl: 'https://github.com/o/r/pull/1' },
          { url: 'u2', source: 'rss', outcome: 'skipped' },
          { url: 'u3', source: 'retry', outcome: 'unannounced' },
        ],
      }),
      { runtime: 'local' },
    );
    expect(message.text).toBe(
      '🗓️ [local] [dry-run] 定期実行: 記事にできる 1 本・スキップ 1 件・詳細未発表 1 件・失敗 0 件 (候補 7 件のうち 3 件を試した)',
    );
    expect(text(message)).toContain('✅ 記事にできる (dry-run)');
  });

  it('lists every URL with its PR, reason, next try and give-up', () => {
    const { message } = buildScheduledRunMessage(
      summary({
        prCount: 1,
        items: [
          { url: 'https://a.example/1', title: 'コラボ', source: 'rss', outcome: 'pr', prUrl: 'https://github.com/o/r/pull/1' },
          {
            url: 'https://a.example/2',
            source: 'rss',
            outcome: 'unannounced',
            reason: '詳細未発表',
            nextAttemptAt: new Date('2026-11-22T01:05:00Z'),
          },
          { url: 'https://a.example/3', source: 'retry', outcome: 'failure', reason: 'HTTP 503', nextAttemptAt: new Date() },
          { url: 'https://a.example/4', source: 'retry', outcome: 'unannounced', givenUpReason: '開始日 (2026-11-20) までに詳細が発表されなかったため打ち切りました' },
        ],
      }),
      CLOUD,
    );
    const body = text(message);
    expect(body).toContain('PR: https://github.com/o/r/pull/1');
    expect(body).toContain('次に試す日: 2026-11-22');
    expect(body).toContain('次の回に試し直します');
    expect(body).toContain('🛑 開始日 (2026-11-20)');
    expect(message.blocks).toHaveLength(1 + 4 + 1);
  });

  it('explains why the run stopped and says when there was nothing to try', () => {
    const stopped = buildScheduledRunMessage(
      summary({ stopReason: 'consecutive-failures', items: [{ url: 'u', source: 'rss', outcome: 'failure' }] }),
      CLOUD,
    );
    expect(text(stopped.message)).toContain('3 件続けて失敗したので止めました');
    expect(text(buildScheduledRunMessage(summary(), CLOUD).message)).toContain('試す候補がありませんでした');
  });

  it('escapes and redacts values from outside', () => {
    const { message } = buildScheduledRunMessage(
      summary({
        items: [{ url: 'https://a.example/<!channel>', source: 'rss', outcome: 'failure', reason: 'key AIzaSyA0123456789012345678901234567890 rejected' }],
      }),
      CLOUD,
    );
    const body = text(message);
    expect(body).not.toContain('<!channel>');
    expect(body).toContain('&lt;!channel&gt;');
    expect(body).toContain('[REDACTED]');
  });
});
