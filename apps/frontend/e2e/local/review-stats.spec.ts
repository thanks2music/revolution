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
 * 開催のページの集計・並び替え・参考になった (one-more-time #165)。公開中の口コミは service role で
 * 直接作る (投稿と審査は review-submit.spec.ts が通す)。
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

/** 公開中の口コミを作る (それぞれ別の会員)。新しい物ほど後に作る */
async function publish(occurrenceId: number, fields: Record<string, unknown>) {
  const author = await data.createMember();
  const { data: row, error } = await data.admin
    .from('reviews')
    .insert({
      occurrence_id: occurrenceId,
      user_id: author.userId,
      status: 'published',
      visited_on: jstDate(-1),
      submitted_at: new Date().toISOString(),
      ...fields,
    })
    .select('id')
    .single();
  if (error) throw error;
  return row.id as number;
}

test('星の分布と行った人のデータを出し、費用は 3 件そろうまで出さない', async ({ page }) => {
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });
  await publish(occurrenceId, {
    rating: 5,
    attendance: 'walk_in',
    food_cost_band: '2000_3000',
    goods_cost_band: 'none',
  });
  await publish(occurrenceId, { rating: 5, attendance: 'walk_in', food_cost_band: '2000_3000' });
  await publish(occurrenceId, { rating: 3, attendance: 'queue', food_cost_band: 'under_2000' });

  await page.goto(path);
  const distribution = page.getByTestId('rating-distribution');
  await expect(distribution.getByText('星5つ 2件')).toBeAttached();
  await expect(distribution.getByText('星3つ 1件')).toBeAttached();

  const visitor = page.getByTestId('visitor-data');
  await expect(visitor).toContainText('口コミ3件から');
  await expect(visitor).toContainText('並ばずそのまま入った人が最多');
  // 飲食代は 3 件そろったので出す。グッズ代は 1 件だけなので出さない
  await expect(visitor).toContainText('飲食代（1人分）');
  await expect(visitor).toContainText('¥2,000〜3,000 が最多');
  await expect(visitor).not.toContainText('グッズ代（1人分）');
});

test('参考になった順に並べ替えられ、会員は「参考になった」を押して取り消せる', async ({
  page,
  context,
  baseURL,
}) => {
  const { occurrenceId, path } = await occurrencePage({
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });
  const helpfulId = await publish(occurrenceId, { rating: 4, body: '参考になる口コミ' });
  await publish(occurrenceId, { rating: 2, body: '新しい口コミ' });
  // 参考になった数はトリガが数えるので、別の会員が押した形で 2 件にする
  for (let i = 0; i < 2; i++) {
    const voter = await data.createMember();
    const { error } = await data.admin
      .from('review_helpful')
      .insert({ review_id: helpfulId, user_id: voter.userId });
    if (error) throw error;
  }

  // このプロジェクトはログインした状態で始まるので、未ログインの確認のために cookie を消す
  await context.clearCookies();
  await page.goto(path);
  const cards = page.getByTestId('review-card');
  await expect(cards.first()).toContainText('新しい口コミ');
  await page.getByRole('button', { name: '参考になった順' }).click();
  await expect(cards.first()).toContainText('参考になる口コミ');
  await expect(cards.first().getByTestId('helpful-button')).toHaveText('参考になった 2');

  // 未ログインで押すと、ログインへ案内する
  await cards.first().getByTestId('helpful-button').click();
  await expect(page).toHaveURL(/\/login\?next=/);

  // 会員は押せて、取り消せる。読み直しても押した状態が残る
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  await page.goto(path);
  await page.getByRole('button', { name: '参考になった順' }).click();
  const button = cards.first().getByTestId('helpful-button');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveText('参考になった 3');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // 件数は先に画面で変わる。保存が終わる (ボタンが押せる状態に戻る) まで待ってから読み直す
  await expect(button).toBeEnabled();
  // 並び替えで一覧を切り替えても、押した状態と件数を保つ
  await page.getByRole('button', { name: '新着順' }).click();
  const sameInLatest = cards.filter({ hasText: '参考になる口コミ' }).getByTestId('helpful-button');
  await expect(sameInLatest).toHaveText('参考になった 3');
  await expect(sameInLatest).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('button', { name: '参考になった順' }).click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveText('参考になった 2');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});
