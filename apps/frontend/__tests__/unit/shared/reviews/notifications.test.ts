import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

import {
  BODY_EXCERPT_CHARS,
  buildSlackMessage,
  createSlackNotifier,
  notifyAboutReview,
  type ReviewNotification,
  type ReviewSummary,
} from '@revolution/reviews/notifications';

/**
 * Slack の通知の文 (#169、Layer 1) と送る口 (Layer 2)。shared のパッケージは自分の jest を持たないので、
 * 公開サイトの jest で確かめる
 */
const REVIEW: ReviewSummary = {
  reviewId: 42,
  authorName: 'あにめ太郎',
  eventName: 'コラボカフェ',
  venueName: '渋谷店',
  rating: 4,
  body: '楽しかった。\nまた行きたい',
};
const ADMIN = 'https://admin.example.test/';

const sectionText = (notification: ReviewNotification) => {
  const { message } = buildSlackMessage(notification, { adminUrl: ADMIN });
  return (message.blocks![0] as { text: { text: string } }).text.text;
};

describe('buildSlackMessage の宛先', () => {
  it.each<[ReviewNotification, 'attention' | 'notice']>([
    [{ type: 'review_submitted', review: REVIEW }, 'notice'],
    [{ type: 'review_edited', review: REVIEW }, 'notice'],
    [{ type: 'review_deleted', review: REVIEW }, 'notice'],
    [{ type: 'review_screened', review: REVIEW, status: 'published', aiFailure: false }, 'notice'],
    [{ type: 'review_screened', review: REVIEW, status: 'rejected', aiFailure: false }, 'notice'],
    [
      { type: 'review_screened', review: REVIEW, status: 'needs_review', aiFailure: false },
      'attention',
    ],
    [
      { type: 'review_screened', review: REVIEW, status: 'needs_review', aiFailure: true },
      'attention',
    ],
    [{ type: 'review_reported', review: REVIEW, reasonCode: 'resale' }, 'attention'],
    [{ type: 'member_joined', displayName: 'あにめ太郎' }, 'notice'],
    [{ type: 'article_liked', displayName: 'あにめ太郎', articleTitle: '記事' }, 'notice'],
  ])('%o → %s', (notification, destination) => {
    expect(buildSlackMessage(notification).destination).toBe(destination);
  });
});

describe('buildSlackMessage の中身', () => {
  it('表示名・開催名・星・本文の冒頭・管理アプリのリンクを載せる', () => {
    const text = sectionText({ type: 'review_submitted', review: REVIEW });
    expect(text).toBe(
      [
        '*口コミが投稿されました*',
        'あにめ太郎 ・ コラボカフェ 渋谷店 ・ 星 4',
        '> 楽しかった。 また行きたい',
        '<https://admin.example.test/reviews/42|管理アプリで開く>',
      ].join('\n')
    );
  });

  it('通報は理由の種類と通報のページへのリンクを載せる (通報した人は載せない)', () => {
    const text = sectionText({ type: 'review_reported', review: REVIEW, reasonCode: 'resale' });
    expect(text).toContain('口コミが通報されました (グッズの譲渡・転売の呼びかけ)');
    expect(text).toContain('<https://admin.example.test/reports/42|管理アプリで開く>');
  });

  it('AI の審査の失敗と、迷ったのを見出しで分ける', () => {
    expect(
      sectionText({
        type: 'review_screened',
        review: REVIEW,
        status: 'needs_review',
        aiFailure: true,
      })
    ).toContain('AI の審査に失敗しました (確認待ち)');
    expect(
      sectionText({
        type: 'review_screened',
        review: REVIEW,
        status: 'needs_review',
        aiFailure: false,
      })
    ).toContain('AI が判断に迷いました (確認待ち)');
    // 会員の提出の後は、提出と結果を 1 通にまとめる
    expect(
      sectionText({
        type: 'review_screened',
        review: REVIEW,
        status: 'published',
        aiFailure: false,
        trigger: 'submitted',
      })
    ).toContain('*口コミが投稿され、AI が公開しました*');
  });

  it('本文は冒頭だけ、外から来た値は Slack の記号を無効にする', () => {
    const text = sectionText({
      type: 'review_submitted',
      review: { ...REVIEW, authorName: '<!channel> & 太郎', body: 'あ'.repeat(200) },
    });
    expect(text).toContain('&lt;!channel&gt; &amp; 太郎');
    expect(text).not.toContain('<!channel>');
    const excerpt = text.split('\n').find(line => line.startsWith('> '))!;
    expect(excerpt.length).toBeLessThanOrEqual(BODY_EXCERPT_CHARS + 2 + 1);
  });

  it('退会済みの投稿者・管理アプリの URL が無い時・消した口コミ', () => {
    expect(
      sectionText({ type: 'review_submitted', review: { ...REVIEW, authorName: null } })
    ).toContain('退会済みユーザー');
    const { message } = buildSlackMessage({ type: 'review_submitted', review: REVIEW });
    expect(JSON.stringify(message)).not.toContain('管理アプリで開く');
    // 消した口コミは管理アプリで開けないのでリンクを付けない
    expect(sectionText({ type: 'review_deleted', review: REVIEW })).not.toContain(
      '管理アプリで開く'
    );
  });

  it('会員登録は表示名だけ、いいねは表示名と記事のタイトルだけ', () => {
    expect(sectionText({ type: 'member_joined', displayName: 'あにめ太郎' })).toBe(
      '*会員が登録しました*\nあにめ太郎'
    );
    expect(
      sectionText({ type: 'article_liked', displayName: null, articleTitle: '<コラボ> の記事' })
    ).toBe('*記事にいいねが付きました*\n&lt;コラボ&gt; の記事 ・ 退会済みユーザー');
  });
});

describe('createSlackNotifier', () => {
  it('env が無ければ送らない (例外も出さない)', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(
      createSlackNotifier({ env: {} }).notify({ type: 'member_joined', displayName: 'a' })
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('送信が例外になっても投げない', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(
      createSlackNotifier({
        env: { SLACK_BOT_TOKEN: 'xoxb-test', SLACK_NOTICE_CHANNEL_ID: 'C_NOTICE' },
      }).notify({ type: 'member_joined', displayName: 'a' })
    ).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });
});

describe('notifyAboutReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('送る口が失敗しても、例外を外へ出さず Sentry に残す', async () => {
    const db = {
      from: () => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => ({
          data: { id: 1, rating: 4, body: 'a', profiles: null, occurrences: null },
          error: null,
        });
        return builder;
      },
    };
    const notifier = { notify: jest.fn(async () => Promise.reject(new Error('slack down'))) };
    await expect(
      notifyAboutReview({ notifier: notifier as never, db: db as never }, 1, review => ({
        type: 'review_submitted',
        review,
      }))
    ).resolves.toBeUndefined();
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { part: 'slack-notification', kind: 'review' },
    });
  });

  it('口コミを読めない時も、例外を外へ出さず Sentry に残す', async () => {
    const failingDb = {
      from: () => {
        throw new Error('db down');
      },
    };
    const notifier = { notify: jest.fn(async () => undefined) };
    await expect(
      notifyAboutReview({ notifier, db: failingDb as never }, 1, review => ({
        type: 'review_submitted',
        review,
      }))
    ).resolves.toBeUndefined();
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
