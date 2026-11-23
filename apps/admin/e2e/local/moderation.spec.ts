import { expect, test, type BrowserContext } from '@playwright/test';

import { sessionCookiesFor } from '../../../frontend/test-support/member-session';
import {
  createTestDataScope,
  jstDate,
  type TestDataScope,
  type TestMember,
} from '../../../frontend/test-support/test-data';

/**
 * BOSS の操作の一本道 (one-more-time #167)。確認待ちの一覧 → 口コミの確認 → 公開 / 差し戻し → 一覧の知らせ。
 * DB の関数の細かい場合分けは結合テスト (apps/frontend/__tests__/integration/review-moderation.test.ts)
 */

let data: TestDataScope;

test.beforeEach(() => {
  data = createTestDataScope();
});

test.afterEach(async () => {
  await data.cleanup();
});

async function signIn(context: BrowserContext, member: TestMember, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await context.addCookies(
    (await sessionCookiesFor(member)).map(({ name, value }) => ({
      name,
      value,
      domain: hostname,
      path: '/',
      sameSite: 'Lax' as const,
    }))
  );
}

/** AI が迷った口コミ (BOSS の確認待ち) を 1 件作る */
async function unsureReview(aiReason: string) {
  const event = await data.createEvent();
  const occurrence = await data.createOccurrence({
    eventId: event.id,
    verified: true,
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });
  const author = await data.createMember();
  const submittedAt = new Date().toISOString();
  const { data: row, error } = await data.admin
    .from('reviews')
    .insert({
      occurrence_id: occurrence.id,
      user_id: author.userId,
      status: 'pending',
      rating: 4,
      body: '平日の夕方に予約なしで入れました。',
      visited_on: jstDate(-1),
      attendance: 'walk_in',
      submitted_at: submittedAt,
    })
    .select('id')
    .single();
  if (error) throw error;
  // AI の審査の書き込みは審査の関数で行う (状態と記録を同じ形で残す)
  const { data: screenResult, error: screenError } = await data.admin.rpc('apply_review_screening', {
    p_review_id: row.id,
    p_submitted_at: submittedAt,
    p_status: 'needs_review',
    p_reason_code: null,
    p_ai_reason: aiReason,
    p_ai_error: null,
    p_ai_model: 'fake',
    p_screened_at: new Date().toISOString(),
    p_photo_ids: [],
    p_photo_marks: [],
  });
  if (screenError) throw screenError;
  if (screenResult !== 'applied') throw new Error(`審査を書けませんでした: ${String(screenResult)}`);
  return { reviewId: row.id as number };
}

async function reviewStatus(reviewId: number) {
  const { data: row, error } = await data.admin
    .from('reviews')
    .select('status, reason_code')
    .eq('id', reviewId)
    .single();
  if (error) throw error;
  return row;
}

test('確認待ちの口コミを公開する', async ({ page, context, baseURL }) => {
  const boss = await data.createMember({ admin: true });
  const review = await unsureReview('E2E: 公開してよいか迷った');
  await signIn(context, boss, baseURL!);

  await page.goto('/');
  await page.locator(`a[href="/reviews/${review.reviewId}"]`).click();
  await expect(page.getByText('E2E: 公開してよいか迷った')).toBeVisible();

  await page.getByRole('button', { name: '公開する' }).click();
  await expect(page).toHaveURL(/notice=published/);
  await expect(page.getByRole('status')).toContainText('を公開しました');
  expect(await reviewStatus(review.reviewId)).toEqual({ status: 'published', reason_code: null });
});

test('確認待ちの口コミを理由を選んで差し戻す', async ({ page, context, baseURL }) => {
  const boss = await data.createMember({ admin: true });
  const review = await unsureReview('E2E: 宣伝かもしれない');
  await signIn(context, boss, baseURL!);

  await page.goto(`/reviews/${review.reviewId}`);
  await page.getByRole('button', { name: '差し戻す' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: '宣伝・開催と関係ない内容' }).click();
  await dialog.getByLabel('投稿者へのひとこと (任意)').fill('開催の感想を書いてください');
  await expect(dialog).toContainText('差し戻しの理由: 宣伝や、この開催と関係のない内容が含まれています。開催の感想を書いてください');
  await dialog.getByRole('button', { name: '差し戻す' }).click();

  await expect(page).toHaveURL(/notice=rejected/);
  expect(await reviewStatus(review.reviewId)).toEqual({ status: 'rejected', reason_code: 'spam' });
});

test('admin でない会員は管理画面に入れない', async ({ page, context, baseURL }) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);

  await page.goto('/');
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByRole('heading')).toHaveText('このアカウントには管理画面の権限がありません');
  await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
});
