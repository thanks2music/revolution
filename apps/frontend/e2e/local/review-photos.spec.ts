import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';

import { getOccurrenceUrl } from '../../lib/event/event-url';
import { sessionCookiesFor } from '../../test-support/member-session';
import {
  createTestDataScope,
  jstDate,
  type TestDataScope,
  type TestMember,
} from '../../test-support/test-data';

/**
 * 口コミの写真 (one-more-time #163)。置き場所は偽物 (一時ディレクトリ、REVIEW_PHOTO_STORAGE=fake)。
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

/** 幅の違う JPEG (表示の URL の幅で見分ける) */
async function jpeg(width: number) {
  return {
    name: `photo-${width}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width, height: 300, channels: 3, background: '#4a9' } })
      .jpeg()
      .toBuffer(),
  };
}

/** 付けた写真の並び (表示の URL の幅) */
async function photoWidths(page: Page): Promise<string[]> {
  const sources = await page
    .getByRole('list', { name: '付けた写真' })
    .locator('img')
    .evaluateAll(images =>
      images.map(image => (image as HTMLImageElement).getAttribute('src') ?? '')
    );
  return sources.map(src => src.match(/\/(\d+)\.webp/)?.[1] ?? '?');
}

test('写真を付ける・断る・並べ替える・外す。口コミが無ければ下書きを先に保存する', async ({
  page,
  context,
  baseURL,
}) => {
  const event = await data.createEvent();
  const occurrence = await data.createOccurrence({
    eventId: event.id,
    verified: true,
    startsOn: jstDate(-10),
    endsOn: jstDate(20),
  });
  const path = getOccurrenceUrl(
    { id: event.id, primaryCategory: { slug: event.categorySlug } },
    occurrence.slug
  );
  const member = await data.createMember();
  await signIn(context, member, baseURL!);

  await page.goto(`${path}/review`);
  const gif = {
    name: 'anim.gif',
    mimeType: 'image/gif',
    buffer: await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .gif()
      .toBuffer(),
  };
  await page.locator('input[type="file"]').setInputFiles([await jpeg(400), gif, await jpeg(600)]);

  // 形式の違う写真は、選んだその場で名前つきの理由を出す
  await expect(page.getByRole('alert').filter({ hasText: 'anim.gif' })).toContainText(
    'JPEG・PNG・HEIC'
  );
  // 2 枚を上げて取り込む (変換した写真を偽の置き場所から読んで出す)
  await expect(page.getByRole('img', { name: '付けた写真 2' })).toBeVisible({ timeout: 30_000 });
  expect(await photoWidths(page)).toEqual(['400', '600']);
  const loaded = await page
    .getByRole('img', { name: '付けた写真 1' })
    .evaluate(image => (image as HTMLImageElement).naturalWidth);
  expect(loaded).toBeGreaterThan(0);

  // 口コミが無かったので、下書きが保存されている
  const { data: reviews } = await data.admin
    .from('reviews')
    .select('status')
    .eq('occurrence_id', occurrence.id);
  expect(reviews).toEqual([{ status: 'draft' }]);

  // 並べ替えて、読み込み直しても残る
  const list = page.getByRole('list', { name: '付けた写真' });
  await page.getByRole('button', { name: '写真 2 を前へ' }).click();
  await expect.poll(() => photoWidths(page)).toEqual(['600', '400']);
  // 画面は先に変わる。保存が終わってから読み込み直す
  await expect(list).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect.poll(() => photoWidths(page)).toEqual(['600', '400']);

  // 外して、読み込み直しても残らない
  await page.getByRole('button', { name: '写真 1 を外す' }).click();
  await expect.poll(() => photoWidths(page)).toEqual(['400']);
  await expect(list).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect.poll(() => photoWidths(page)).toEqual(['400']);
});
