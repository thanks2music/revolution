/**
 * Layer 1: the Slack message for one scheduled run (one message per run, decided 2026-11-15).
 */
import { describe, expect, it } from '@jest/globals';

import type { ScheduledRunSummary } from '@/lib/scheduled/summary';
import { buildScheduledRunMessage, needsAttention, scheduledRunLinks } from '@/lib/slack/scheduled-run-message';

const CLOUD = { runtime: 'cloud-run' as const, mentionUserId: 'U0000000001' };

const summary = (overrides: Partial<ScheduledRunSummary> = {}): ScheduledRunSummary => ({
  dryRun: false,
  startedAt: new Date('2026-11-15T01:05:00Z'),
  finishedAt: new Date('2026-11-15T01:47:00Z'),
  items: [],
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
            { url: 'u1', registered: false, outcome: 'skipped' },
            { url: 'u2', registered: false, outcome: 'unannounced' },
          ],
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ['a PR', summary({ items: [{ url: 'u', registered: false, outcome: 'pr' }] })],
    ['a failure', summary({ items: [{ url: 'u', registered: false, outcome: 'failure' }] })],
    ['an unreadable feed', summary({ feedErrors: ['コラボカフェ: 503'] })],
    ['an error of the run', summary({ stopReason: 'error', error: 'UNAVAILABLE' })],
  ])('%s needs a person', (_, value) => {
    expect(needsAttention(value)).toBe(true);
  });
});

describe('buildScheduledRunMessage', () => {
  it('mentions only when a person is needed', () => {
    const quiet = buildScheduledRunMessage(summary({ items: [{ url: 'u', registered: false, outcome: 'skipped' }] }), CLOUD);
    expect(quiet.attention).toBe(false);
    expect(quiet.message.text).not.toContain('<@');

    const loud = buildScheduledRunMessage(summary({ items: [{ url: 'u', registered: false, outcome: 'failure', reason: 'x' }] }), CLOUD);
    expect(loud.attention).toBe(true);
    expect(loud.message.text.startsWith('<@U0000000001> ❌ [production]')).toBe(true);
  });

  it('counts each outcome in the summary line and marks a dry run', () => {
    const { message } = buildScheduledRunMessage(
      summary({
        dryRun: true,
        candidateCount: 7,
        items: [
          { url: 'u1', registered: false, outcome: 'pr', prUrl: 'https://github.com/o/r/pull/1' },
          { url: 'u2', registered: false, outcome: 'skipped' },
          { url: 'u3', registered: false, outcome: 'unannounced' },
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
        items: [
          { url: 'https://a.example/1', registered: false, title: 'コラボ', outcome: 'pr', prUrl: 'https://github.com/o/r/pull/1' },
          {
            url: 'https://a.example/2',
            registered: false,
            outcome: 'unannounced',
            reason: '詳細未発表',
            nextAttemptAt: new Date('2026-11-22T01:05:00Z'),
          },
          { url: 'https://a.example/3', registered: false, outcome: 'failure', reason: 'HTTP 503', nextAttemptAt: new Date() },
          { url: 'https://a.example/4', registered: false, outcome: 'unannounced', givenUpReason: '開始日 (2026-11-20) までに詳細が発表されなかったため打ち切りました' },
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

  it('shows why a page outside the writing scope was skipped, with no next try and no mention', () => {
    const { message, attention } = buildScheduledRunMessage(
      summary({
        items: [
          {
            url: 'https://a.example/1',
            registered: false,
            outcome: 'skipped',
            reason: '書く対象の外 (種別 pop-up-store / 運営 LTR)',
            nextAttemptAt: null,
          },
        ],
      }),
      CLOUD,
    );
    const body = text(message);
    expect(body).toContain('書く対象の外 (種別 pop-up-store / 運営 LTR)');
    expect(body).not.toContain('次に試す日');
    expect(attention).toBe(false);
  });

  it('marks URLs registered from the admin UI', () => {
    const { message } = buildScheduledRunMessage(
      summary({
        items: [
          { url: 'https://reg.example/1', registered: true, outcome: 'skipped' },
          { url: 'https://rss.example/1', registered: false, outcome: 'skipped' },
        ],
      }),
      CLOUD,
    );
    const lines = message.blocks.map(block => JSON.stringify(block));
    expect(lines.find(line => line.includes('reg.example'))).toContain('(登録 URL)');
    expect(lines.find(line => line.includes('rss.example'))).not.toContain('(登録 URL)');
  });

  it('explains why the run stopped and says when there was nothing to try', () => {
    const stopped = buildScheduledRunMessage(
      summary({ stopReason: 'consecutive-failures', items: [{ url: 'u', registered: false, outcome: 'failure' }] }),
      CLOUD,
    );
    expect(text(stopped.message)).toContain('3 件続けて失敗したので止めました');
    expect(text(buildScheduledRunMessage(summary(), CLOUD).message)).toContain('試す候補がありませんでした');
  });

  it('escapes and redacts values from outside', () => {
    const { message } = buildScheduledRunMessage(
      summary({
        items: [{ url: 'https://a.example/<!channel>', registered: false, outcome: 'failure', reason: 'key AIzaSyA0123456789012345678901234567890 rejected' }],
      }),
      CLOUD,
    );
    const body = text(message);
    expect(body).not.toContain('<!channel>');
    expect(body).toContain('&lt;!channel&gt;');
    expect(body).toContain('[REDACTED]');
  });
});

describe('links to the next step', () => {
  it('ends the message with the open article PRs and the registered-URL page', () => {
    const { message } = buildScheduledRunMessage(summary(), CLOUD, {
      openPrs: 'https://github.com/o/r/pulls?q=is%3Apr',
      registeredUrls: 'https://admin.example/registered-urls',
    });
    const footer = JSON.stringify(message.blocks[message.blocks.length - 1]);
    expect(footer).toContain('<https://github.com/o/r/pulls?q=is%3Apr|開いている記事 PR>');
    expect(footer).toContain('<https://admin.example/registered-urls|URL 登録の画面>');
  });

  it('leaves the links out when they are not known', () => {
    const { message } = buildScheduledRunMessage(summary(), CLOUD);
    expect(JSON.stringify(message.blocks[message.blocks.length - 1])).not.toContain('<http');
  });

  it('says a dry run made no PR', () => {
    expect(text(buildScheduledRunMessage(summary({ dryRun: true }), CLOUD).message)).toContain('PR は作っていません');
    expect(text(buildScheduledRunMessage(summary(), CLOUD).message)).not.toContain('PR は作っていません');
  });
});

describe('scheduledRunLinks', () => {
  it('builds the PR search for article branches and the admin page from the env', () => {
    const links = scheduledRunLinks({
      GITHUB_OWNER: 'o',
      GITHUB_REPO: 'r',
      AI_WRITER_ADMIN_URL: 'https://admin.example/',
    });
    expect(links.openPrs).toBe(`https://github.com/o/r/pulls?q=${encodeURIComponent('is:pr is:open head:ai-writer/')}`);
    expect(links.registeredUrls).toBe('https://admin.example/registered-urls');
  });

  it.each([
    ['no env', {}],
    ['a repo name that would break the link', { GITHUB_OWNER: 'o', GITHUB_REPO: 'r|x', AI_WRITER_ADMIN_URL: 'javascript:alert(1)' }],
    ['an admin URL that is not a URL', { AI_WRITER_ADMIN_URL: 'not a url' }],
  ])('leaves out what it cannot build safely (%s)', (_, env) => {
    expect(scheduledRunLinks(env as NodeJS.ProcessEnv)).toEqual({ openPrs: undefined, registeredUrls: undefined });
  });
});
