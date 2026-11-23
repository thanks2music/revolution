import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';

import { getOccurrenceUrl } from '../../lib/event/event-url';
import { localSql } from '../../test-support/local-supabase';
import { createTestDataScope, type TestDataScope } from '../../test-support/test-data';

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
  sql = localSql();
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

/** 「…」→「通報する」で通報のダイアログを開く */
async function openReportDialog(page: Page) {
  await page
    .getByTestId('review-card')
    .getByRole('button', { name: /口コミのメニュー/ })
    .click();
  await page.getByRole('menuitem', { name: '通報する' }).click();
  return page.getByTestId('report-dialog');
}

test('ログインしていなくても「…」から通報でき、同じ端末の通報は 1 件にまとまる', async ({
  page,
  context,
}) => {
  await context.clearCookies();
  const { reviewId, event, occurrence } = await data.createReview({
    rating: 2,
    body: 'グッズを譲ります。DM ください',
  });
  await page.goto(
    getOccurrenceUrl(
      { id: event.id, primaryCategory: { slug: event.categorySlug } },
      occurrence.slug
    )
  );

  let dialog = await openReportDialog(page);
  // 自由記述の欄は無い
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('radio')).toHaveCount(8);
  await dialog.getByRole('radio', { name: 'グッズの譲渡・転売の呼びかけ' }).click();
  await dialog.getByRole('button', { name: '通報する' }).click();
  await expect(dialog.getByText('受け付けました')).toBeVisible();
  await page.keyboard.press('Escape');

  // 開き直しても受け付けた知らせのまま
  dialog = await openReportDialog(page);
  await expect(dialog.getByText('受け付けました')).toBeVisible();
  await page.keyboard.press('Escape');

  // ページを開き直して、同じ端末からもう一度送る
  await page.reload();
  dialog = await openReportDialog(page);
  await dialog.getByRole('radio', { name: '宣伝・スパム・開催と無関係' }).click();
  await dialog.getByRole('button', { name: '通報する' }).click();
  await expect(dialog.getByText('受け付けました')).toBeVisible();

  const reports = await sql<{ reason_code: string; reporter_device_id: string | null }[]>`
    SELECT reason_code, reporter_device_id FROM public.review_reports
    WHERE review_id = ${reviewId} AND status = 'open'`;
  expect(reports).toHaveLength(1);
  expect(reports[0].reason_code).toBe('resale');
  const device = (await context.cookies()).find(cookie => cookie.name === 'review_reporter');
  expect(device?.httpOnly).toBe(true);
  expect(reports[0].reporter_device_id).toBe(device?.value);
});
