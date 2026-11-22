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
 * 口コミを書く開催を選ぶ (7-0) と、ログイン・onboarding の後に元の画面へ戻ること (one-more-time #166)。
 *
 * ログインはメールのコード (OTP) なので、E2E ではコードを入れる代わりに会員の cookie を入れ、
 * ログインのフォームが向かう戻り先 (?next=) を開く (LoginForm はログインが済むとそこへ進む)。
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

test('未ログインで「投稿」タブを押すと、理由つきでログインへ案内し、ログインの後に 7-0 から #7 へ進める', async ({
  page,
  context,
  baseURL,
}) => {
  const marker = `ななぜろ${Date.now()}`;
  const event = await data.createEvent({ name: `${marker} コラボカフェ` });
  const occurrence = await data.createOccurrence({
    eventId: event.id,
    verified: true,
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });

  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('link', { name: '投稿' })
    .click();
  await expect(page).toHaveURL(/\/login\?next=%2Freview$/);
  await expect(page.getByRole('status')).toContainText('口コミを書くには、ログインしてください');

  // ログインが済んだ状態にして、ログインのフォームが向かう戻り先を開く
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const next = new URL(page.url()).searchParams.get('next')!;
  await page.goto(next);
  await expect(page.getByRole('heading', { name: '口コミを書く開催' })).toBeVisible();

  await page.getByRole('searchbox', { name: '作品名・会場名で探す' }).fill(marker);
  await page.getByRole('searchbox', { name: '作品名・会場名で探す' }).press('Enter');
  await page.getByTestId('review-target').filter({ hasText: marker }).click();
  await expect(page).toHaveURL(new RegExp(`/${event.id}/${occurrence.slug}/review$`));
  await expect(page.getByRole('heading', { name: '口コミを書く' })).toBeVisible();
});

test('onboarding の途中なら、プロフィールの登録の後に来た画面 (7-0) へ戻る', async ({
  page,
  context,
  baseURL,
}) => {
  const member = await data.createMember({ onboarded: false });
  await signIn(context, member, baseURL!);

  await page.goto('/review');
  await expect(page).toHaveURL(/\/onboarding\?next=%2Freview$/);
  await page.getByLabel('表示名').fill('ななぜろ');
  await page.getByLabel('ユーザー名 (ID)').fill(`t${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'はじめる' }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole('heading', { name: '口コミを書く開催' })).toBeVisible();
});

test('7-0 では、開催前の開催は選べず、いつから書けるかを出す。見た開催は「最近見た開催」に出る', async ({
  page,
  context,
  baseURL,
}) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  const marker = `ななぜろ${Date.now()}`;
  const event = await data.createEvent({ name: `${marker} 原画展` });
  await data.createOccurrence({
    eventId: event.id,
    verified: true,
    startsOn: jstDate(10),
    endsOn: jstDate(30),
  });
  const { path } = await occurrencePage({ startsOn: jstDate(-10), endsOn: jstDate(20) });

  await page.goto(`/review?q=${encodeURIComponent(marker)}`);
  const scheduled = page.getByTestId('review-target').filter({ hasText: marker });
  await expect(scheduled).toHaveAttribute('aria-disabled', 'true');
  await expect(scheduled).toContainText('から書けます');

  // 開催のページを見ると、7-0 の「最近見た開催」に出る
  await page.goto(path);
  await expect(page.getByTestId('rating-count')).toBeVisible();
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '最近見た開催' })).toBeVisible();
});

test('開催のページの「口コミの状態」: 0 件は最初の口コミ、開催前はいつから書けるか', async ({
  page,
}) => {
  const ongoing = await occurrencePage({ startsOn: jstDate(-10), endsOn: jstDate(20) });
  await page.goto(ongoing.path);
  await expect(page.getByTestId('review-state')).toHaveAttribute('data-kind', 'empty');
  await expect(page.getByTestId('review-state')).toContainText('まだ口コミはありません');

  const scheduled = await occurrencePage({ startsOn: jstDate(10), endsOn: jstDate(30) });
  await page.goto(scheduled.path);
  await expect(page.getByTestId('review-state')).toHaveAttribute('data-kind', 'notYet');
  await expect(page.getByTestId('review-state')).toContainText('から書けます');
  await expect(
    page.getByTestId('review-state').getByRole('link', { name: '口コミを書く' })
  ).toHaveCount(0);
});
