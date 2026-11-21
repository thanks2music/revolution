/**
 * Layer 2: 口コミの Server Action (submitReview) の契約
 *
 *   - 開催は URL の種別・企画 ID・開催の slug からサーバーで引く (クライアントの開催 ID は使わない)
 *   - 開催中か終了の開催にだけ書ける
 *   - 投稿者は getUser() から取る。未ログインは needsAuth
 *   - 入力の誤りは欄ごとの誤りで返す
 *   - 二重の投稿 (23505)・期間外の訪問日 (23514) は Sentry に送らず、利用者向けの文で返す
 *   - 挿入の後に after() で審査を走らせ、公開になったら開催のページを作り直す
 *
 * DB の振る舞い (RLS・トリガ) は __tests__/integration/reviews-*.test.ts で確かめる。
 */

jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/occurrence/queries', () => ({ getOccurrenceDetail: jest.fn() }));
jest.mock('@/lib/auth/member', () => ({ getCurrentMember: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => {
  const ownBuilder: any = {};
  ownBuilder.select = jest.fn(() => ownBuilder);
  ownBuilder.eq = jest.fn(() => ownBuilder);
  ownBuilder.is = jest.fn(() => ownBuilder);
  ownBuilder.maybeSingle = jest.fn();
  return {
    __ownBuilder: ownBuilder,
    createAdminClient: jest.fn(() => ({ admin: true, from: jest.fn(() => ownBuilder) })),
  };
});
jest.mock('@/lib/reviews/screener', () => ({
  getReviewScreener: jest.fn(async () => ({ screen: jest.fn() })),
}));
jest.mock('@/lib/reviews/operations', () => ({ screenSubmittedReview: jest.fn() }));
jest.mock('@/lib/reviews/authoring', () => {
  const actual = jest.requireActual('@/lib/reviews/authoring') as Record<string, unknown>;
  return {
    toContentColumns: actual.toContentColumns,
    findOwnReview: jest.fn(),
    saveDraft: jest.fn(),
    submitDraft: jest.fn(),
    deleteOwnReview: jest.fn(),
  };
});
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/server', () => ({ after: jest.fn() }));
jest.mock('@/lib/supabase/server', () => {
  const builder: any = {};
  builder.insert = jest.fn(() => builder);
  builder.select = jest.fn(() => builder);
  builder.single = jest.fn();
  builder.update = jest.fn(() => builder);
  builder.eq = jest.fn();
  return {
    __builder: builder,
    createClient: jest.fn(async () => ({ from: jest.fn(() => builder) })),
  };
});

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { deleteReview, getOwnReviewState, saveReviewDraft, submitReview } from '@/actions/review';
import { getCurrentMember } from '@/lib/auth/member';
import { getOccurrenceDetail } from '@/lib/occurrence/queries';
import { screenSubmittedReview } from '@/lib/reviews/operations';
import { deleteOwnReview, findOwnReview, saveDraft, submitDraft } from '@/lib/reviews/authoring';

const builder = (jest.requireMock('@/lib/supabase/server') as { __builder: any }).__builder;

const ROUTE = { eventType: 'collabo-cafe', eventId: '12', occurrenceSlug: 'shibuya' };
const INPUT = {
  rating: 4,
  visitedOn: '2026-11-20',
  attendance: 'walk_in' as const,
  foodCostBand: null,
  goodsCostBand: null,
  body: '楽しかった',
  hasSpoiler: false,
};

function detail(status = 'ongoing') {
  return {
    occurrence: { id: 34, slug: 'shibuya', status },
    event: { id: 12, primaryCategory: { slug: 'collabo-cafe' } },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getOccurrenceDetail as jest.Mock).mockResolvedValue(detail());
  (getCurrentMember as jest.Mock).mockResolvedValue({ ok: true, profileId: 'profile-1' });
  builder.insert.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data: { id: 56 }, error: null });
  builder.update.mockReturnValue(builder);
  builder.eq.mockResolvedValue({ error: null });
  (findOwnReview as jest.Mock).mockResolvedValue(null);
});

it('開催をサーバーで引き、投稿者は会員の profiles.id で挿入する', async () => {
  await expect(submitReview(ROUTE, INPUT)).resolves.toEqual({ ok: true, reviewId: 56 });

  expect(getOccurrenceDetail).toHaveBeenCalledWith('12', 'shibuya');
  expect(builder.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      occurrence_id: 34,
      user_id: 'profile-1',
      rating: 4,
      visited_on: '2026-11-20',
    })
  );
});

it('onboarding を済ませていない会員は書けない (Server Action はどのルートからも呼べるため)', async () => {
  (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'not_onboarded' });

  await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({ ok: false, needsAuth: true });
  expect(builder.insert).not.toHaveBeenCalled();
});

it('開催の取得が例外を投げても、型付きの結果で返し、Sentry に送る', async () => {
  (getOccurrenceDetail as jest.Mock).mockRejectedValue(new Error('failed to load'));

  await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({ ok: false });
  expect(Sentry.captureException).toHaveBeenCalled();
});

it('挿入の後に審査を走らせ、公開になったら開催のページを作り直す', async () => {
  (screenSubmittedReview as jest.Mock).mockResolvedValue({
    kind: 'screened',
    status: 'published',
    occurrenceId: 34,
  });
  await submitReview(ROUTE, INPUT);

  const task = (after as jest.Mock).mock.calls[0][0] as () => Promise<void>;
  await task();
  expect(screenSubmittedReview).toHaveBeenCalledWith(
    56,
    expect.objectContaining({ db: expect.objectContaining({ admin: true }) })
  );
  expect(revalidatePath).toHaveBeenCalledWith('/collabo-cafe/12/shibuya');
  expect(revalidatePath).toHaveBeenCalledWith('/collabo-cafe/12');
});

it('公開以外の結果ではページを作り直さない', async () => {
  (screenSubmittedReview as jest.Mock).mockResolvedValue({
    kind: 'screened',
    status: 'rejected',
    occurrenceId: 34,
  });
  await submitReview(ROUTE, INPUT);
  await ((after as jest.Mock).mock.calls[0][0] as () => Promise<void>)();

  expect(revalidatePath).not.toHaveBeenCalled();
});

it('審査が例外になっても Sentry に送るだけで、投げない', async () => {
  (screenSubmittedReview as jest.Mock).mockRejectedValue(new Error('db down'));
  await submitReview(ROUTE, INPUT);

  await expect(
    ((after as jest.Mock).mock.calls[0][0] as () => Promise<void>)()
  ).resolves.toBeUndefined();
  expect(Sentry.captureException).toHaveBeenCalled();
});

it.each([['scheduled'], ['unscheduled'], ['cancelled']])('%s の開催には書けない', async status => {
  (getOccurrenceDetail as jest.Mock).mockResolvedValue(detail(status));

  await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({ ok: false });
  expect(builder.insert).not.toHaveBeenCalled();
});

it('URL の種別が違えば開催が見つからない扱いにする', async () => {
  await expect(submitReview({ ...ROUTE, eventType: 'pop-up-store' }, INPUT)).resolves.toEqual({
    ok: false,
    error: '開催が見つかりません',
  });
});

it('未ログインは needsAuth を返す', async () => {
  (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });

  await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({ ok: false, needsAuth: true });
});

it('入力の誤りは欄ごとに返す', async () => {
  const result = await submitReview(ROUTE, { ...INPUT, rating: 0, body: 'あ'.repeat(2001) });

  expect(result).toMatchObject({ ok: false, fieldErrors: { rating: '星を選んでください' } });
  expect(result.ok === false && result.fieldErrors?.body).toBeDefined();
  expect(builder.insert).not.toHaveBeenCalled();
});

it('二重の投稿は利用者向けの文で返し、Sentry に送らない', async () => {
  builder.single.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });

  await expect(submitReview(ROUTE, INPUT)).resolves.toEqual({
    ok: false,
    error: 'この開催には、もう口コミを書いています',
  });
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it('期間外の訪問日は訪問日の欄の誤りにする', async () => {
  builder.single.mockResolvedValue({
    data: null,
    error: { code: '23514', message: 'review visited_on is out of range' },
  });

  await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({
    ok: false,
    fieldErrors: { visitedOn: expect.any(String) },
  });
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it('DB の障害は Sentry に送る', async () => {
  builder.single.mockResolvedValue({
    data: null,
    error: { code: '08006', message: 'connection failure' },
  });

  await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({ ok: false });
  expect(Sentry.captureException).toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});

it('会員でなければ、入力の誤りより先にログインの案内を返す', async () => {
  (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });

  await expect(submitReview(ROUTE, { ...INPUT, rating: 0 })).resolves.toMatchObject({
    ok: false,
    needsAuth: true,
  });
});

it('トリガ以外の CHECK の違反は想定外として Sentry に送る', async () => {
  builder.single.mockResolvedValue({
    data: null,
    error: { code: '23514', message: 'new row violates check constraint "reviews_rating_chk"' },
  });

  await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({ ok: false });
  expect(Sentry.captureException).toHaveBeenCalled();
});

it('開催の状態のトリガの拒否は、まだ書けない扱いにする', async () => {
  builder.single.mockResolvedValue({
    data: null,
    error: { code: '23514', message: 'review occurrence is scheduled' },
  });

  await expect(submitReview(ROUTE, INPUT)).resolves.toEqual({
    ok: false,
    error: 'この開催には、まだ口コミを書けません',
  });
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

describe('getOwnReviewState', () => {
  const own = (jest.requireMock('@/lib/supabase/admin') as { __ownBuilder: any }).__ownBuilder;
  const row = (fields: Record<string, unknown>) =>
    own.maybeSingle.mockResolvedValue({
      data: {
        status: 'pending',
        reason_code: null,
        reason_note: null,
        visited_on: '2026-11-20',
        ...fields,
      },
      error: null,
    });

  beforeEach(() => {
    own.select.mockReturnValue(own);
    own.eq.mockReturnValue(own);
    own.is.mockReturnValue(own);
  });

  it.each([['pending'], ['needs_review']])('%s は本人には審査中として見せる', async status => {
    row({ status, reason_code: status === 'needs_review' ? 'ai_failure' : null });

    await expect(getOwnReviewState(34)).resolves.toEqual({
      status: 'screening',
      reasonCode: null,
      visitedOn: '2026-11-20',
      note: null,
    });
  });

  it('差し戻しは理由のコードと運営の補足を返す', async () => {
    row({ status: 'rejected', reason_code: 'spam', reason_note: '宣伝の URL が含まれていたため' });

    await expect(getOwnReviewState(34)).resolves.toMatchObject({
      status: 'rejected',
      reasonCode: 'spam',
      note: '宣伝の URL が含まれていたため',
    });
  });

  it('本人の行は会員の profiles.id で引く', async () => {
    row({});
    await getOwnReviewState(34);

    expect(own.eq).toHaveBeenCalledWith('occurrence_id', 34);
    expect(own.eq).toHaveBeenCalledWith('user_id', 'profile-1');
  });

  it('下書き・口コミが無い・会員でない時は null', async () => {
    row({ status: 'draft' });
    await expect(getOwnReviewState(34)).resolves.toBeNull();

    own.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getOwnReviewState(34)).resolves.toBeNull();

    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    await expect(getOwnReviewState(34)).resolves.toBeNull();
  });

  it('不正な開催 ID には問い合わせない', async () => {
    await expect(getOwnReviewState(0)).resolves.toBeNull();
    expect(own.maybeSingle).not.toHaveBeenCalled();
  });
});

describe('既に口コミがある開催への提出', () => {
  const EXISTING = {
    rating: 3,
    visitedOn: '2026-11-19',
    attendance: null,
    foodCostBand: null,
    goodsCostBand: null,
    body: '前の本文',
    hasSpoiler: false,
  };

  it('下書きなら提出する (状態はサーバーが書く) し、審査を走らせる', async () => {
    (findOwnReview as jest.Mock).mockResolvedValue({ id: 70, status: 'draft', ...EXISTING });
    (submitDraft as jest.Mock).mockResolvedValue(true);

    await expect(submitReview(ROUTE, INPUT)).resolves.toEqual({ ok: true, reviewId: 70 });
    expect(submitDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ profileId: 'profile-1', reviewId: 70 })
    );
    expect(builder.insert).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
  });

  it('別の端末で先に提出された下書きは、提出済みとして返す', async () => {
    (findOwnReview as jest.Mock).mockResolvedValue({ id: 70, status: 'draft', ...EXISTING });
    (submitDraft as jest.Mock).mockResolvedValue(false);

    await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({ ok: false });
    expect(after).not.toHaveBeenCalled();
  });

  it('提出した口コミなら内容の変更にし、公開中だったらページをすぐ作り直す', async () => {
    (findOwnReview as jest.Mock).mockResolvedValue({ id: 71, status: 'published', ...EXISTING });

    await expect(submitReview(ROUTE, INPUT)).resolves.toEqual({ ok: true, reviewId: 71 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ body: '楽しかった', rating: 4 })
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 71);
    expect(revalidatePath).toHaveBeenCalledWith('/collabo-cafe/12/shibuya');
    expect(after).toHaveBeenCalled();
  });

  it('提出の時の DB のトリガの拒否は、利用者向けの文にする', async () => {
    (findOwnReview as jest.Mock).mockResolvedValue({ id: 70, status: 'draft', ...EXISTING });
    (submitDraft as jest.Mock).mockRejectedValue({
      code: '23514',
      message: 'review visited_on is out of range',
    });

    await expect(submitReview(ROUTE, INPUT)).resolves.toMatchObject({
      ok: false,
      fieldErrors: { visitedOn: expect.any(String) },
    });
  });
});

describe('saveReviewDraft', () => {
  it('星と訪問日が空でも保存する', async () => {
    (saveDraft as jest.Mock).mockResolvedValue({ kind: 'saved', reviewId: 80 });

    await expect(
      saveReviewDraft(ROUTE, { ...INPUT, rating: null, visitedOn: null })
    ).resolves.toEqual({ ok: true, reviewId: 80 });
    expect(saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ profileId: 'profile-1', occurrenceId: 34 })
    );
  });

  it('もう提出した口コミがあれば、下書きにはしない', async () => {
    (saveDraft as jest.Mock).mockResolvedValue({ kind: 'not_draft' });

    await expect(saveReviewDraft(ROUTE, INPUT)).resolves.toMatchObject({ ok: false });
  });

  it('開催前の開催には下書きも保存できない', async () => {
    (getOccurrenceDetail as jest.Mock).mockResolvedValue(detail('scheduled'));

    await expect(saveReviewDraft(ROUTE, INPUT)).resolves.toMatchObject({ ok: false });
    expect(saveDraft).not.toHaveBeenCalled();
  });
});

describe('deleteReview', () => {
  it('本人の口コミを削除し、公開中だったらページを作り直す', async () => {
    (deleteOwnReview as jest.Mock).mockResolvedValue({
      kind: 'deleted',
      occurrenceId: 34,
      wasPublished: true,
    });

    await expect(deleteReview(ROUTE, 71)).resolves.toEqual({ ok: true });
    expect(deleteOwnReview).toHaveBeenCalledWith(expect.anything(), {
      profileId: 'profile-1',
      reviewId: 71,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/collabo-cafe/12/shibuya');
  });

  it('本人のものでない・無い口コミは見つからない扱いにする', async () => {
    (deleteOwnReview as jest.Mock).mockResolvedValue({ kind: 'not_found' });

    await expect(deleteReview(ROUTE, 71)).resolves.toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('未ログインは消せない', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });

    await expect(deleteReview(ROUTE, 71)).resolves.toMatchObject({ ok: false, needsAuth: true });
    expect(deleteOwnReview).not.toHaveBeenCalled();
  });
});
