import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

/**
 * 公開になった口コミが開催のページに出るまで、ページを開き直す。審査は DB に「公開」と書いてから
 * ページを作り直す (`revalidatePath`) ので、DB が公開になった直後は、まだ前のページが返ることがある
 */
async function gotoUntilReviewShown(page: Page, path: string, text?: string) {
  await expect(async () => {
    await page.goto(path);
    const cards = page.getByTestId('review-card');
    await expect(text ? cards.filter({ hasText: text }) : cards).toHaveCount(1, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
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

test('公開された口コミは開催のページに出て、星の平均と件数に入る', async ({
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
  await page.getByRole('radio', { name: /^4 つ星/ }).click();
  await page.getByRole('radio', { name: '並ばずそのまま入った' }).click();
  await page.getByRole('textbox', { name: /^本文/ }).fill('展示が充実していて満足です');
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'published' });

  await gotoUntilReviewShown(page, path);
  const card = page.getByTestId('review-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('展示が充実していて満足です');
  await expect(card).toContainText('並ばずそのまま入った');
  await expect(card).toContainText(/\d{4}年\d{1,2}月 訪問/);
  await expect(page.getByTestId('rating-average')).toHaveText('4.0');
  await expect(page.getByTestId('rating-count')).toHaveText('1件');
  await expect(page.getByTestId('own-review-status')).toContainText('公開中です');
  await page.screenshot({ path: testInfo.outputPath('occurrence-reviews.png'), fullPage: true });
  // スマホの幅では「口コミを書く」が下のタブのバーの上に固定される
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('link', { name: '口コミを書く' }).last()).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('occurrence-reviews-mobile.png') });
});

test('ネタバレの口コミは本文をたたみ、押すと開く', async ({ page, context, baseURL }) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });

  await page.goto(`${path}/review`);
  await page.getByRole('radio', { name: /^5 つ星/ }).click();
  await page.getByRole('textbox', { name: /^本文/ }).fill('最後の部屋に原画があります');
  await page.getByRole('switch').click();
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'published' });

  await gotoUntilReviewShown(page, path);
  await expect(page.getByText('最後の部屋に原画があります')).toBeHidden();
  await page.getByText('表示する ›').click();
  await expect(page.getByText('最後の部屋に原画があります')).toBeVisible();
});

test('差し戻された口コミは開催のページに出ず、本人にだけ理由が見える', async ({
  page,
  context,
  baseURL,
}) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });

  await page.goto(`${path}/review`);
  await page.getByRole('radio', { name: /^1 つ星/ }).click();
  await page.getByRole('textbox', { name: /^本文/ }).fill('[reject:spam] 当店へどうぞ');
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'rejected' });

  await page.goto(path);
  await expect(page.getByTestId('review-card')).toHaveCount(0);
  await expect(page.getByTestId('rating-count')).toHaveText('0件');
  await expect(page.getByTestId('own-review-status')).toContainText(
    '宣伝や、この開催と関係のない内容'
  );

  // ログインしていない人には、本人の欄も出ない
  await context.clearCookies();
  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rating-count')).toHaveText('0件');
  await expect(page.getByTestId('own-review-status')).toHaveCount(0);
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

test('下書きは星と訪問日が空でも保存でき、別の端末から続けて提出できる', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });

  await page.goto(`${path}/review`);
  await page.getByLabel(/^訪問日/).fill('');
  await page.getByRole('textbox', { name: /^本文/ }).fill('途中まで書いた');
  await page.getByRole('button', { name: '下書きを保存' }).click();
  await expect(page.getByRole('status')).toContainText('下書きを保存しました');
  // 下書きは審査に回らない
  expect(await statusOf(occurrenceId, member.userId)).toMatchObject({ status: 'draft' });

  // 別の端末 (別のブラウザのコンテキスト) から開くと、続きになる
  const other = await browser.newContext();
  await signIn(other, member, baseURL!);
  const otherPage = await other.newPage();
  await otherPage.goto(`${baseURL}${path}/review`);
  await expect(otherPage.getByText('保存した下書きの続きです。')).toBeVisible();
  await expect(otherPage.getByRole('textbox', { name: /^本文/ })).toHaveValue('途中まで書いた');
  await otherPage.getByRole('radio', { name: /^4 つ星/ }).click();
  await otherPage.getByLabel(/^訪問日/).fill(jstDate(-1));
  await otherPage.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(otherPage.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'published' });
  await other.close();
});

test('もう口コミがある開催では、その編集になる。公開中に直すと審査し直し、最終編集日が出る', async ({
  page,
  context,
  baseURL,
}) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });

  await page.goto(`${path}/review`);
  await page.getByRole('radio', { name: /^5 つ星/ }).click();
  await page.getByRole('textbox', { name: /^本文/ }).fill('最初の本文');
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'published' });

  await page.goto(`${path}/review`);
  await expect(page.getByText(/もう一度審査されるまで公開されません/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^本文/ })).toHaveValue('最初の本文');
  // 提出した後は下書きに戻せない
  await expect(page.getByRole('button', { name: '下書きを保存' })).toHaveCount(0);
  await page.getByRole('textbox', { name: /^本文/ }).fill('直した本文');
  await page.getByRole('button', { name: '直して出し直す' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();

  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'published' });
  await gotoUntilReviewShown(page, path, '直した本文');
  await expect(page.getByTestId('review-card')).toContainText('直した本文');
  await expect(page.getByTestId('review-card')).toContainText('最終編集');
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
