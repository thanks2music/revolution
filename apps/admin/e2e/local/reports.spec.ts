import { randomUUID } from 'node:crypto';

import { expect, test, type BrowserContext } from '@playwright/test';

import { sessionCookiesFor } from '../../../frontend/test-support/member-session';
import {
  anonClient,
  createTestDataScope,
  type TestDataScope,
  type TestMember,
} from '../../../frontend/test-support/test-data';

/**
 * 通報の処理の一本道 (one-more-time #168)。未ログインの閲覧者の通報 → 管理アプリの通報の一覧 → 非公開 /
 * ネタバレの印を付けて公開のまま。通報は公開サイトのサーバーと同じく service role の submit_review_report で作る
 * (公開サイトの画面からの通報は apps/frontend/e2e/local/review-report.spec.ts)。
 * DB の関数の細かい場合分けは結合テスト (apps/frontend/__tests__/integration/review-report-handling.test.ts)
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

/** 公開中の口コミを作り、未ログインの端末から理由ごとに通報する */
async function reportedReview(body: string, reasons: string[]) {
  const review = await data.createReview({ body });
  for (const reason of reasons) {
    const { data: result, error } = await data.admin.rpc('submit_review_report', {
      p_review_id: review.reviewId,
      p_reason_code: reason,
      p_reporter_profile_id: null,
      p_reporter_device_id: randomUUID(),
    });
    if (error) throw error;
    expect(result).toBe('accepted');
  }
  const { data: event } = await data.admin
    .from('events')
    .select('name')
    .eq('id', review.event.id)
    .single();
  return { ...review, eventName: event!.name as string };
}

test('通報された口コミを、理由を選んで非公開にする', async ({ page, context, baseURL }) => {
  const { reviewId, eventName } = await reportedReview('限定アクスタ、定価で譲ります。DM ください', [
    'resale',
    'resale',
    'spam',
  ]);
  const boss = await data.createMember({ admin: true });
  await signIn(context, boss, baseURL!);

  await page.goto('/reports');
  const row = page.getByRole('link').filter({ hasText: eventName });
  await expect(row).toContainText('通報 3 件');
  await expect(row).toContainText('グッズの譲渡・転売の呼びかけ（2）、宣伝・スパム・開催と無関係（1）');
  await row.click();

  await page.getByRole('button', { name: '非公開にする' }).click();
  const dialog = page.getByRole('dialog');
  // 初めは最も多い通報の理由
  await expect(dialog.getByRole('radio', { name: 'グッズの譲渡・転売の呼びかけ' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await dialog.getByRole('textbox').fill('譲渡の呼びかけを消して、出し直してください');
  await expect(dialog).toContainText(
    '非公開の理由: グッズの譲渡・交換・転売の呼びかけが含まれています。譲渡の呼びかけを消して、出し直してください'
  );
  await dialog.getByRole('button', { name: '非公開にする' }).click();

  await expect(page).toHaveURL(/\/reports\?notice=hidden/);
  await expect(page.getByRole('status')).toContainText('口コミを非公開にしました');
  await expect(page.getByRole('link').filter({ hasText: eventName })).toHaveCount(0);

  const { data: review } = await data.admin
    .from('reviews')
    .select('status, reason_code')
    .eq('id', reviewId)
    .single();
  expect(review).toEqual({ status: 'hidden', reason_code: 'resale' });
  // 閲覧者には見えない
  const { data: visible } = await anonClient().from('reviews').select('id').eq('id', reviewId);
  expect(visible).toEqual([]);
});

test('ネタバレの印を付けて、公開のまま閉じる', async ({ page, context, baseURL }) => {
  const { reviewId, eventName } = await reportedReview('最後の展示で犯人が分かります', [
    'spoiler_unmarked',
  ]);
  const boss = await data.createMember({ admin: true });
  await signIn(context, boss, baseURL!);

  await page.goto(`/reports/${reviewId}`);
  const keep = page.getByRole('button', { name: '問題なしにする' });
  await expect(keep).toBeVisible();
  await page.getByRole('checkbox', { name: 'ネタバレを含む' }).check();
  await page.getByRole('button', { name: '直して公開のままにする' }).click();

  await expect(page).toHaveURL(/\/reports\?notice=kept/);
  await expect(page.getByRole('link').filter({ hasText: eventName })).toHaveCount(0);
  const { data: review } = await data.admin
    .from('reviews')
    .select('status, has_spoiler')
    .eq('id', reviewId)
    .single();
  expect(review).toEqual({ status: 'published', has_spoiler: true });
});
