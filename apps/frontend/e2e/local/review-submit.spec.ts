import { expect, test, type BrowserContext } from '@playwright/test';

import { getOccurrenceUrl } from '../../lib/event/event-url';
import { sessionCookiesFor } from '../../test-support/member-session';
import {
  createTestDataScope,
  jstDate,
  type TestDataScope,
  type TestMember,
} from '../../test-support/test-data';

/**
 * 口コミの投稿 (one-more-time #161)。会員が #7 で口コミを提出し、偽の審査器 (`REVIEW_SCREENER=fake`、
 * playwright.local-db.config.ts の webServer) が応答の後に結果を書くまでを通す。
 *
 * 口コミを書くので、共有の会員ではなく自分専用の会員を作る (member.setup.ts の注意)。
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
  const cookies = await sessionCookiesFor(member);
  await context.clearCookies();
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      domain: hostname,
      path: '/',
      sameSite: 'Lax' as const,
    }))
  );
}

/** 開催と、その開催のページの URL を作る */
async function occurrencePage(input: { startsOn: string | null; endsOn: string }) {
  const event = await data.createEvent();
  const occurrence = await data.createOccurrence({ eventId: event.id, verified: true, ...input });
  const path = getOccurrenceUrl(
    { id: event.id, primaryCategory: { slug: event.categorySlug } },
    occurrence.slug
  );
  return { occurrenceId: occurrence.id, path };
}

async function statusOf(occurrenceId: number, userId: string) {
  const { data: review } = await data.admin
    .from('reviews')
    .select('status, reason_code')
    .eq('occurrence_id', occurrenceId)
    .eq('user_id', userId)
    .maybeSingle();
  return review;
}

test('口コミを提出すると投稿ステータスが出て、審査を通ると公開になる', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });

  await page.goto(`${path}/review`);
  await expect(page.getByRole('heading', { name: '口コミを書く' })).toBeVisible();

  await page.getByRole('radio', { name: /^4 つ星/ }).click();
  await expect(page.getByText('満足した', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '事前予約して入った' }).click();
  await page.getByRole('radio', { name: '¥2,000〜3,000' }).click();
  await page
    .getByRole('textbox', { name: /^本文/ })
    .fill('平日の夕方に予約なしで入れました。パフェは想像より大きかった。');
  await expect(page.getByText(/^\d+ \/ 2000$/)).toHaveText('31 / 2000');
  await page.screenshot({ path: testInfo.outputPath('review-form.png'), fullPage: true });

  await page.getByRole('button', { name: '口コミを投稿する' }).click();

  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'X で共有する' })).toHaveAttribute(
    'href',
    /^https:\/\/x\.com\/intent\/post\?/
  );
  await page.screenshot({ path: testInfo.outputPath('review-submitted.png'), fullPage: true });

  // 審査は応答の後 (after()) に走る
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({
      status: 'published',
      reason_code: null,
    });
});

test('当たる本文は差し戻しになり、理由が残る', async ({ page, context, baseURL }) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });

  await page.goto(`${path}/review`);
  await page.getByRole('radio', { name: /^2 つ星/ }).click();
  await page.getByRole('textbox', { name: /^本文/ }).fill('[reject:resale] 缶バッジ譲ります');
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();

  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({
      status: 'rejected',
      reason_code: 'resale',
    });
});

test('もう口コミがある開催では、書けない理由を出す', async ({ page, context, baseURL }) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { path } = await occurrencePage({ startsOn: jstDate(-10), endsOn: jstDate(20) });

  await page.goto(`${path}/review`);
  await page.getByRole('radio', { name: /^5 つ星/ }).click();
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();

  await page.goto(`${path}/review`);
  await expect(page.getByText('この開催には、もう口コミを書いています。')).toBeVisible();
});

test('開催前の開催には書けない', async ({ page, context, baseURL }) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { path } = await occurrencePage({ startsOn: jstDate(5), endsOn: jstDate(20) });

  await page.goto(`${path}/review`);

  await expect(page.getByText(/まだ始まっていません/)).toBeVisible();
  await expect(page.getByRole('button', { name: '口コミを投稿する' })).toHaveCount(0);
});

test.describe('ログインしていない時', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('投稿のページを開くとログインへ送られる', async ({ page }) => {
    const { path } = await occurrencePage({ startsOn: jstDate(-10), endsOn: jstDate(20) });

    await page.goto(`${path}/review`);

    await expect(page).toHaveURL(/\/login/);
  });
});
