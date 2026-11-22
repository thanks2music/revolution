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
 * #12 マイページの自分の口コミ (one-more-time #162)。差し戻しの理由を見て出し直し、公開された口コミを
 * 削除して書き直すまでを通す。審査は偽の審査器 (`REVIEW_SCREENER=fake`) が本文の目印で決める。
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
    .is('deleted_at', null)
    .maybeSingle();
  return review;
}

test('差し戻しの理由をマイページで見て、直して出し直すと公開され、削除すると書き直せる', async ({
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
  await page.getByRole('radio', { name: /^3 つ星/ }).click();
  await page.getByRole('textbox', { name: /^本文/ }).fill('[reject:spam] 当店へどうぞ');
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'rejected' });

  // マイページに、差し戻しと理由が出る
  await page.goto('/mypage');
  const item = page.getByTestId('own-review-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('差し戻し');
  await expect(item).toContainText(
    '差し戻しの理由: 宣伝や、この開催と関係のない内容が含まれています'
  );

  // 直して出し直す
  await item.getByRole('link', { name: '直して出し直す' }).click();
  await expect(page.getByText(/直して出し直すと、もう一度審査されます/)).toBeVisible();
  await page.getByRole('textbox', { name: /^本文/ }).fill('ゆっくり楽しめました');
  await page.getByRole('button', { name: '直して出し直す' }).click();
  await expect(page.getByRole('heading', { name: '投稿ステータス' })).toBeVisible();
  await expect
    .poll(() => statusOf(occurrenceId, member.userId), { timeout: 15_000 })
    .toMatchObject({ status: 'published' });

  await page.goto('/mypage');
  await expect(item).toContainText('公開中');
  await expect(item).not.toContainText('差し戻しの理由');

  // 削除すると一覧から消え、同じ開催にもう一度新しく書ける
  await item.getByRole('button', { name: '削除' }).click();
  await item.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByTestId('own-review-item')).toHaveCount(0);
  expect(await statusOf(occurrenceId, member.userId)).toBeNull();

  await page.goto(`${path}/review`);
  await expect(page.getByRole('button', { name: '口コミを投稿する' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下書きを保存' })).toBeVisible();
});

test('下書きはマイページに出て、続きを書ける', async ({ page, context, baseURL }) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const { path } = await occurrencePage({ startsOn: jstDate(-10), endsOn: jstDate(20) });

  await page.goto(`${path}/review`);
  await page.getByRole('textbox', { name: /^本文/ }).fill('途中まで');
  await page.getByRole('button', { name: '下書きを保存' }).click();
  await expect(page.getByRole('status')).toContainText('下書きを保存しました');

  await page.goto('/mypage');
  const item = page.getByTestId('own-review-item');
  await expect(item).toContainText('下書き');
  await item.getByRole('link', { name: '続きを書く' }).click();
  await expect(page.getByRole('textbox', { name: /^本文/ })).toHaveValue('途中まで');
});
