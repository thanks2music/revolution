import { describe, expect, it } from '@jest/globals';

import type { ReviewQueueItem } from '@revolution/reviews/moderation';

import {
  agoLabel,
  aiFailureSummary,
  elapsedLabel,
  formatDate,
  formatDateTime,
  headlineOf,
  detailKind,
  historyLine,
  reportReasonsLabel,
  queuePosition,
  queueOrder,
  queueSections,
  starsLabel,
} from '@/lib/moderation/format';

const item = (reviewId: number, kind: ReviewQueueItem['kind']): ReviewQueueItem => ({
  reviewId,
  kind,
  aiReason: null,
  aiError: null,
  submittedAt: '2026-11-23T00:00:00Z',
  pendingSince: '2026-11-23T00:00:00Z',
  rating: 4,
  eventName: `企画 ${reviewId}`,
  venueName: null,
  authorName: null,
  photoCount: 0,
});

describe('queueSections / queueOrder', () => {
  it('止まっている → 失敗 → 迷った の順に節を分け、空の節は出さない。節の中は元の順', () => {
    const items = [item(1, 'unsure'), item(2, 'stuck'), item(3, 'unsure'), item(4, 'stuck')];
    expect(queueSections(items).map(section => [section.kind, section.items.map(i => i.reviewId)])).toEqual([
      ['stuck', [2, 4]],
      ['unsure', [1, 3]],
    ]);
    expect(queueOrder(items).map(i => i.reviewId)).toEqual([2, 4, 1, 3]);
  });
});

describe('時間と日付', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  it.each([
    ['2026-11-23T09:18:00Z', '42 分'],
    ['2026-11-23T08:55:00Z', '1 時間 5 分'],
    ['2026-11-23T08:00:00Z', '2 時間'],
    ['2026-11-21T09:00:00Z', '2 日'],
    ['2026-11-23T10:05:00Z', '0 分'],
  ])('%s から %s', (since, label) => {
    expect(elapsedLabel(since, now)).toBe(label);
  });

  it('「前」の形は空白を詰める', () => {
    expect(agoLabel('2026-11-23T08:55:00Z', now)).toBe('1時間5分前');
  });

  it('日時は JST、日付は年月日', () => {
    expect(formatDateTime('2026-11-23T05:02:00Z')).toBe('2026.11.23 14:02');
    expect(formatDate('2026-07-19')).toBe('2026年7月19日');
  });

  it('星', () => {
    expect(starsLabel(4)).toBe('★★★★☆');
    expect(starsLabel(null)).toBe('—');
  });
});

describe('aiFailureSummary', () => {
  it.each([
    ['gemini request timed out after 20000ms', '時間切れ'],
    ['review photos kept changing during screening', '写真の変化'],
    ['review photos could not be read', '写真の読み込み'],
    ['screening prompt is missing or invalid', '設定の不備'],
    ['429 Too Many Requests', '回数の上限'],
    ['something else', 'エラー'],
    [null, 'エラー'],
  ])('%s → %s', (error, label) => {
    expect(aiFailureSummary(error).label).toBe(label);
  });
});

describe('headlineOf', () => {
  it('最初の 1 文を出し、長ければ切る。無ければ「AI が迷った」', () => {
    expect(headlineOf('写真 3 に他人の顔。本文は問題なし。')).toBe('写真 3 に他人の顔');
    expect(headlineOf('あ'.repeat(40), 10)).toBe(`${'あ'.repeat(10)}…`);
    expect(headlineOf(null)).toBe('AI が迷った');
  });
});

describe('historyLine', () => {
  const entry = (actor: 'ai' | 'admin', action: string, toStatus: string, reasonCode: string | null) => ({
    actor,
    action,
    toStatus,
    reasonCode,
  });
  it.each([
    [entry('ai', 'screened', 'needs_review', null), 'AI: 迷った'],
    [entry('ai', 'screened', 'needs_review', 'personal_info'), 'AI: 迷った (個人情報・他人の顔)'],
    [entry('ai', 'screened', 'needs_review', 'ai_failure'), 'AI: 審査に失敗'],
    [entry('ai', 'screened', 'published', null), 'AI: 公開'],
    [entry('admin', 'requeued', 'pending', null), 'BOSS: もう一度 AI にかけた'],
    [entry('admin', 'rejected', 'rejected', 'spam'), 'BOSS: 差し戻し'],
    // 通報の処理 (0029)
    [entry('admin', 'hidden', 'hidden', 'resale'), 'BOSS: 通報: 非公開にした (グッズの譲渡・転売の呼びかけ)'],
    [entry('admin', 'kept', 'published', null), 'BOSS: 通報: 直して公開のまま'],
    [entry('admin', 'dismissed', 'published', null), 'BOSS: 通報: 問題なし'],
  ])('%o → %s', (event, line) => {
    const { who, what } = historyLine(event);
    expect(`${who}: ${what}`).toBe(line);
  });
});

describe('detailKind', () => {
  it.each([
    [{ status: 'pending', reason_code: null }, 'stuck', true],
    [{ status: 'pending', reason_code: null }, 'screening', false],
    [{ status: 'needs_review', reason_code: 'ai_failure' }, 'ai_failure'],
    [{ status: 'needs_review', reason_code: 'personal_info' }, 'unsure'],
    [{ status: 'needs_review', reason_code: null }, 'unsure'],
    [{ status: 'published', reason_code: null }, 'closed'],
    [{ status: 'rejected', reason_code: 'spam' }, 'closed'],
    [{ status: 'draft', reason_code: null }, 'closed'],
  ])('%o → %s', (review, kind, stuck = false) => {
    expect(detailKind(review, stuck)).toBe(kind);
  });
});

describe('queuePosition', () => {
  const order = [{ reviewId: 7 }, { reviewId: 3 }, { reviewId: 9 }];
  it('一覧の中の位置を「n / m」で返す', () => {
    expect(queuePosition(order, 3)).toBe('2 / 3');
  });
  it('一覧に無ければ null', () => {
    expect(queuePosition(order, 1)).toBeNull();
  });
});

describe('reportReasonsLabel', () => {
  it('理由ごとの件数を Figma 16 の形で並べる', () => {
    expect(
      reportReasonsLabel([
        { code: 'resale', count: 2 },
        { code: 'spam', count: 1 },
      ])
    ).toBe('グッズの譲渡・転売の呼びかけ（2）、宣伝・スパム・開催と無関係（1）');
  });
});
