import { describe, expect, it } from '@jest/globals';

import { ownReviewMeta, ownReviewView } from '@/lib/reviews/own-review-view';

describe('ownReviewView', () => {
  it('状態ごとにバッジと編集の入口の言葉を決める', () => {
    const none = { reasonCode: null, reasonNote: null };
    expect(ownReviewView({ status: 'draft', ...none })).toMatchObject({
      badge: '下書き',
      editLabel: '続きを書く',
    });
    expect(ownReviewView({ status: 'published', ...none })).toMatchObject({
      badge: '公開中',
      editLabel: '編集',
    });
    expect(ownReviewView({ status: 'rejected', ...none })).toMatchObject({
      badge: '差し戻し',
      editLabel: '直して出し直す',
    });
  });

  it('BOSS の確認待ちは、本人には審査中と同じに見せる', () => {
    expect(
      ownReviewView({ status: 'needs_review', reasonCode: 'ai_failure', reasonNote: null })
    ).toEqual(ownReviewView({ status: 'pending', reasonCode: null, reasonNote: null }));
  });

  it('差し戻しと非公開には理由を出し、運営の補足を続ける', () => {
    expect(
      ownReviewView({ status: 'rejected', reasonCode: 'resale', reasonNote: null }).reason
    ).toBe('差し戻しの理由: グッズの譲渡・交換・転売の呼びかけが含まれています。');
    expect(
      ownReviewView({ status: 'hidden', reasonCode: 'spam', reasonNote: '店名の宣伝の部分です' })
        .reason
    ).toBe('非公開の理由: 宣伝や、この開催と関係のない内容が含まれています。店名の宣伝の部分です');
  });

  it('公開中などには理由を出さない。理由が何も無ければ欄を出さない', () => {
    expect(
      ownReviewView({ status: 'published', reasonCode: 'spam', reasonNote: 'x' }).reason
    ).toBeNull();
    expect(
      ownReviewView({ status: 'rejected', reasonCode: 'ai_failure', reasonNote: null }).reason
    ).toBeNull();
  });
});

describe('ownReviewMeta', () => {
  const base = { helpfulCount: 0, updatedAt: '2026-11-17T16:00:00Z' };

  it('訪問日を出し、公開中なら参考になった数を足す', () => {
    expect(
      ownReviewMeta({
        ...base,
        status: 'published',
        visitedOn: '2026-07-19',
        helpfulCount: 24,
      })
    ).toBe('2026年7月19日 訪問 ・ 参考になった 24');
  });

  it('下書きは入っている所だけと、保存日 (JST) を出す', () => {
    expect(ownReviewMeta({ ...base, status: 'draft', visitedOn: null })).toBe('2026.11.18 保存');
  });
});
