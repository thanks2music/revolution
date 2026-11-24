import * as Sentry from '@sentry/nextjs';

import { reportReview } from '@/actions/review-report';
import { getCurrentMember } from '@/lib/auth/member';
import { createAdminClient } from '@/lib/supabase/admin';
import { after } from 'next/server';
import { notifyAboutReview } from '@revolution/reviews/notifications';

jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/auth/member', () => ({ getCurrentMember: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('next/server', () => ({ after: jest.fn() }));
jest.mock('@/lib/reviews/notifier', () => ({
  getReviewNotifier: () => ({ enabled: true, notify: jest.fn() }),
}));
jest.mock('@revolution/reviews/notifications', () => ({ notifyAboutReview: jest.fn() }));

const cookieStore = { get: jest.fn(), set: jest.fn() };
jest.mock('next/headers', () => ({ cookies: jest.fn(async () => cookieStore) }));

const rpc = jest.fn();
const DEVICE = '3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

beforeEach(() => {
  jest.clearAllMocks();
  (createAdminClient as jest.Mock).mockReturnValue({ rpc });
  rpc.mockResolvedValue({ data: 'accepted', error: null });
  cookieStore.get.mockReturnValue(undefined);
});

describe('reportReview', () => {
  it('会員の通報は profiles.id で送り、端末の cookie は作らない', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: true, profileId: 'profile-1' });

    await expect(reportReview(7, 'resale')).resolves.toEqual({ ok: true });

    expect(rpc).toHaveBeenCalledWith('submit_review_report', {
      p_review_id: 7,
      p_reason_code: 'resale',
      p_reporter_profile_id: 'profile-1',
      p_reporter_device_id: null,
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('未ログインの通報は、端末の cookie を作って (HttpOnly・1 年) その乱数で送る', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });

    await expect(reportReview(7, 'spam')).resolves.toEqual({ ok: true });

    const [name, value, options] = cookieStore.set.mock.calls[0];
    expect(name).toBe('review_reporter');
    expect(value).toMatch(/^[0-9a-f-]{36}$/);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 31536000 });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_reporter_profile_id: null,
      p_reporter_device_id: value,
    });
  });

  it('端末の cookie があれば、それを使う (同じ端末の通報を 1 件にまとめるため)', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    cookieStore.get.mockReturnValue({ value: DEVICE });

    await reportReview(7, 'spam');

    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_reporter_device_id: DEVICE });
  });

  it('cookie の形が違えば作り直す', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'not_onboarded' });
    cookieStore.get.mockReturnValue({ value: 'not-a-uuid' });

    await reportReview(7, 'spam');

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_reporter_device_id).not.toBe('not-a-uuid');
  });

  it.each([
    ['知らない理由', 7, 'ai_failure'],
    ['不正な ID', -1, 'spam'],
  ])('%s は送らない', async (_label, reviewId, reason) => {
    await expect(reportReview(reviewId, reason)).resolves.toEqual({
      ok: false,
      error: '通報の理由を選んでください',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('公開中でない口コミは、理由を返し Sentry に送らない', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: true, profileId: 'profile-1' });
    rpc.mockResolvedValue({ data: 'not_found', error: null });

    await expect(reportReview(7, 'spam')).resolves.toMatchObject({ ok: false });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('DB のエラーは Sentry に送り、もう一度試すよう伝える', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: true, profileId: 'profile-1' });
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'down' } });

    await expect(reportReview(7, 'spam')).resolves.toEqual({
      ok: false,
      error: '送れませんでした。時間をおいて、もう一度お試しください',
    });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe('reportReview — Slack の要対応 (#169)', () => {
  it('新しく入った通報だけ、応答の後に知らせる', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    await expect(reportReview(7, 'resale')).resolves.toEqual({ ok: true });

    expect(after).toHaveBeenCalledTimes(1);
    await ((after as jest.Mock).mock.calls[0][0] as () => Promise<void>)();
    const [, reviewId, build] = (notifyAboutReview as jest.Mock).mock.calls[0];
    expect(reviewId).toBe(7);
    expect(build({ reviewId: 7 })).toEqual({
      type: 'review_reported',
      review: { reviewId: 7 },
      reasonCode: 'resale',
    });
  });

  it('同じ人の重なった通報 (duplicate) は、受け付けたと返し、知らせない', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: true, profileId: 'profile-1' });
    rpc.mockResolvedValue({ data: 'duplicate', error: null });
    await expect(reportReview(7, 'spam')).resolves.toEqual({ ok: true });
    expect(after).not.toHaveBeenCalled();
  });
});
