import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { getOccurrenceUrl } from '../../lib/event/event-url';
import { getLocalSupabaseEnv } from '../../test-support/local-supabase';
import { createTestDataScope, jstDate, type TestDataScope } from '../../test-support/test-data';

/**
 * 口コミの通報 (one-more-time #168)。ログインしていない閲覧者が、開催のページの口コミの「…」から理由を
 * 選んで通報し、「受け付けました」を見る。同じ端末からもう一度送っても、通報は 1 件のまま。
 *
 * 通報の表は関数からしか読み書きできない (service role にも渡していない) ので、件数はローカルの DB に
 * 直接つないで数える
 */
let data: TestDataScope;
let sql: postgres.Sql;

test.beforeAll(() => {
  sql = postgres(getLocalSupabaseEnv().dbUrl, { max: 1, onnotice: () => {} });
});
test.afterAll(async () => {
  await sql.end();
});
test.beforeEach(() => {
  data = createTestDataScope();
});
test.afterEach(async () => {
  await data.cleanup();
});

async function publishedReview() {
  const event = await data.createEvent();
  const occurrence = await data.createOccurrence({
    eventId: event.id,
    verified: true,
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });
  const author = await data.createMember();
  const { data: row, error } = await data.admin
    .from('reviews')
    .insert({
      occurrence_id: occurrence.id,
      user_id: author.userId,
      status: 'published',
      rating: 2,
      body: 'グッズを譲ります。DM ください',
      visited_on: jstDate(-1),
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  const path = getOccurrenceUrl(
    { id: event.id, primaryCategory: { slug: event.categorySlug } },
    occurrence.slug
  );
  return { reviewId: row.id as number, path };
}

async function openReports(reviewId: number) {
  const rows = await sql<{ reason_code: string; reporter_device_id: string | null }[]>`
    SELECT reason_code, reporter_device_id FROM public.review_reports
    WHERE review_id = ${reviewId} AND status = 'open'`;
  return rows;
}

test('ログインしていなくても「…」から通報でき、同じ端末の通報は 1 件にまとまる', async ({
  page,
  context,
}) => {
  await context.clearCookies();
  const { reviewId, path } = await publishedReview();
  await page.goto(path);

  const card = page.getByTestId('review-card').filter({ hasText: 'グッズを譲ります' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await card.getByRole('button', { name: /口コミのメニュー/ }).click();
    await page.getByRole('menuitem', { name: '通報する' }).click();

    const dialog = page.getByTestId('report-dialog');
    if (attempt === 0) {
      // 自由記述の欄は無い
      await expect(dialog.getByRole('textbox')).toHaveCount(0);
      await expect(dialog.getByRole('radio')).toHaveCount(8);
      await dialog.getByRole('radio', { name: 'グッズの譲渡・転売の呼びかけ' }).click();
      await dialog.getByRole('button', { name: '通報する' }).click();
      await expect(dialog.getByText('受け付けました')).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      // 開き直しても受け付けた知らせのまま。ページを開き直して、もう一度送る
      await expect(dialog.getByText('受け付けました')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.reload();
      await card.getByRole('button', { name: /口コミのメニュー/ }).click();
      await page.getByRole('menuitem', { name: '通報する' }).click();
      await dialog.getByRole('radio', { name: '宣伝・スパム・開催と無関係' }).click();
      await dialog.getByRole('button', { name: '通報する' }).click();
      await expect(dialog.getByText('受け付けました')).toBeVisible();
    }
  }

  const reports = await openReports(reviewId);
  expect(reports).toHaveLength(1);
  expect(reports[0].reason_code).toBe('resale');
  const device = (await context.cookies()).find(cookie => cookie.name === 'review_reporter');
  expect(device?.httpOnly).toBe(true);
  expect(reports[0].reporter_device_id).toBe(device?.value);
});
