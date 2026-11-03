import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * 企画・開催の URL (`/{種別}/{id}`、2026-11-03) が返す HTTP status の回帰検証。
 *
 * ## 何を守っているか
 *
 * - 未知のパス・旧形式 `/events/{id}` は **本物の 404** を返す
 * - 種別が実際と違う URL は **308** で正しい URL へ転送する (ID が正)
 *
 * どちらも、ルートに `app/loading.tsx` があると壊れる。ストリーミングが先に 200 を
 * 確定させるため、`notFound()` はソフト 404 (200)、`permanentRedirect()` は 200 +
 * `<meta http-equiv="refresh">` になる (公式 `loading.js` の「Status Codes」)。
 * 2026-11-03 に `loading.tsx` を動的ルートだけへ移して直した。誰かがルートに戻しても
 * ビルドもテストも落ちないので、status をここで固定する。
 *
 * ## 前提
 *
 * `layout.spec.ts` と同じく、staging を向いたサーバが 4444 で動いていること
 * (`playwright.config.ts` の docstring)。CI では動かない。
 * 対象の企画は `/events` から選ぶ (中身が取り込みで入れ替わるため固定しない)。
 */

/** 実際の種別と違う種別を 1 つ選ぶ。どちらも migration 0017 の前後で存在する slug。 */
const otherType = (type: string) => (type === 'collabo-cafe' ? 'pop-up-store' : 'collabo-cafe');

type Fixture = { type: string; id: string; occurrenceSlug: string };

let fixture: Fixture;

/**
 * 転送を追わずに status と転送先のパスを取る。
 *
 * ⚠️ `Location` は**同じ値が 2 本**付くことがある。Next.js 16.2 は ISR のキャッシュが無い
 *    初回の描画 (`x-nextjs-cache: MISS`) で、`app-render` が応答に直接付けたヘッダーを
 *    キャッシュの記録からもう一度足すため (2 回目以降は 1 本)。値が同じならブラウザは
 *    普通に転送する (2026-11-03 Chromium で実測)。よって重複は除き、値が 1 つに定まることを見る。
 */
async function statusOf(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  const locations = new Set(
    res
      .headersArray()
      .filter(({ name }) => name.toLowerCase() === 'location')
      .map(({ value }) => new URL(value, 'http://placeholder').pathname),
  );
  return {
    status: res.status(),
    location: locations.size === 0 ? undefined : [...locations].join(' | '),
  };
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto('/events');
    const events = (
      await page.$$eval('a[href]', (anchors) => anchors.map((a) => a.getAttribute('href') ?? ''))
    ).filter((href) => /^\/[a-z0-9-]+\/\d+$/.test(href));
    expect(events.length, '/events に企画リンクが無い (staging のデータを確認)').toBeGreaterThan(0);

    const eventUrl = events[0];
    await page.goto(eventUrl);
    const occurrences = (
      await page.$$eval('a[href]', (anchors) => anchors.map((a) => a.getAttribute('href') ?? ''))
    ).filter((href) => href.startsWith(`${eventUrl}/`));
    expect(occurrences.length, `${eventUrl} に開催リンクが無い`).toBeGreaterThan(0);

    const [, type, id] = eventUrl.split('/');
    fixture = { type, id, occurrenceSlug: occurrences[0].slice(eventUrl.length + 1) };
  } finally {
    await page.close();
  }
});

test('正しい URL は 200', async ({ request }) => {
  const { type, id, occurrenceSlug } = fixture;
  for (const path of [
    '/events',
    `/${type}`,
    `/${type}/${id}`,
    `/${type}/${id}/${occurrenceSlug}`,
  ]) {
    expect((await statusOf(request, path)).status, path).toBe(200);
  }
});

test('種別が違う URL は 308 で正しい URL へ転送する', async ({ request }) => {
  const { type, id, occurrenceSlug } = fixture;
  const wrong = otherType(type);

  expect(await statusOf(request, `/${wrong}/${id}`)).toEqual({
    status: 308,
    location: `/${type}/${id}`,
  });
  expect(await statusOf(request, `/${wrong}/${id}/${occurrenceSlug}`)).toEqual({
    status: 308,
    location: `/${type}/${id}/${occurrenceSlug}`,
  });
});

test('存在しないパスと旧形式の URL は 404', async ({ request }) => {
  const { type, id, occurrenceSlug } = fixture;
  for (const path of [
    '/no-such-type', // 未知の種別 (1 階層。dynamicParams = false)
    `/no-such-type/${id}`, // 未知の種別の企画
    `/events/${id}`, // 旧形式 (後方互換なし、BOSS 決定)
    `/events/${id}/${occurrenceSlug}`,
    `/${type}/99999999`, // 存在しない企画
    `/${type}/abc`, // ID でない
    `/${type}/${id}/no-such-occurrence`, // 存在しない開催
  ]) {
    expect((await statusOf(request, path)).status, path).toBe(404);
  }
});
