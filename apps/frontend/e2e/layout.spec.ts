import { expect, test, type Page } from '@playwright/test';

/**
 * PC レイアウト (レスポンシブ) の回帰検証 — S2 「PC レイアウトのレスポンシブ化」。
 *
 * ## 何を守っているか
 *
 * 器 (`w-main` = `clamp(0px, 1050px, 90vw)`) は元から全ページに入っていた。
 * 壊れていたのは**器の中身がモバイル 1 カラム設計のまま**だったことで、
 * 「PC がスマホの拡大表示に見える」原因はそれ。本 spec はその是正が
 * **後退しないこと**だけを見る。
 *
 * ## 2 層構成 (耐久性が違うので役割を分ける)
 *
 * | 層 | 何を見るか | データ変動 |
 * |---|---|---|
 * | **(a) 列数アサーション** — 本命 | `data-grid-cols` の**宣言**と、実際に描かれた
 *   grid track 数が一致するか | **強い**。1 件しか無くても track 数は変わらない |
 * | **(b) スクリーンショット** — 補助 | 上記以外の視覚的な崩れ | **弱い**。件数や
 *   作品名が変われば壊れる。`--update-snapshots` で更新する運用 |
 *
 * 🔴 **(b) の基準画像は gitignored** (BOSS 判断 2026-08-25、`.gitignore` の
 *    e2e スナップショット除外ルール)。よって **clone をまたいだ回帰検知はできない**。
 *    各作業コピーで一度 `--update-snapshots` を回して**自分の基準**を作り、
 *    「自分の編集で描画が変わったか」を見るためのローカル専用ガードとして使う。
 *    repo に載って共有されるのは **(a) だけ**なので、守りたい仕様は (a) に書く。
 *
 * ### (a) が「自作自演」でない理由
 *
 * `data-grid-cols` は**意図の宣言**、grid track 数は**Tailwind が実際に生成した
 * 結果**で、両者の出どころが違う。よって `lg:grid-col-3` のような**綴り間違いで
 * クラスが無効化され、黙って 1 カラムに戻る**事故を検出できる。
 * これは `animate-[…]` が存在しない `@keyframes` を参照してもビルドが通り、
 * 全ページでドットが静止していた 2026-08-22 の事故と同型の失敗モードで、
 * tsc / eslint / 既存テストのいずれも捕まえられない。
 *
 * ⚠️ 検査テストを足したら **mutation test で実効性を確かめること** — 実際に
 *    どれか 1 つの `lg:grid-cols-3` を消してみて、本 spec が落ちるのを見る。
 *
 * ## 🔴 実行前提
 *
 * **staging を向いた dev サーバが `localhost:4444` で起動していること。**
 * 素の `pnpm dev` は production の Supabase を向いてデータが空になるため
 * 検証にならない。起動手順とスクリーンショット運用は
 * `playwright.config.ts` の docstring を参照。
 *
 * **clone 直後や新しいマシンでは必ず** `pnpm test:visual --update-snapshots` を
 * 一度回して基準画像を作る (基準画像は gitignored で、Playwright は不在時に
 * 失敗する仕様のため)。列数アサーションだけを回すなら
 * `pnpm test:visual --grep 列数` で基準画像は要らない。
 */

/** 検証する 3 幅。Tailwind の既定ブレークポイント sm=640 / md=768 / lg=1024 を跨ぐ。 */
const WIDTHS = [
  { key: 'mobile', width: 375 },
  { key: 'tablet', width: 768 },
  { key: 'desktop', width: 1280 },
] as const;

/**
 * 日付をまたぐだけで中身が変わる表示。スクリーンショットから除外する。
 * 現状は残日数バッジ (`RemainingDaysBadge`) のみ。
 */
const VOLATILE_MASK = '[data-volatile]';

type RouteKey =
  | 'titles'
  | 'events'
  | 'venues'
  | 'titleHub'
  | 'titleOccurrences'
  | 'venueDetail'
  | 'eventDetail'
  | 'occurrenceDetail';

type Routes = Record<RouteKey, string>;

/** スクリーンショットを撮る対象。全 8 ルートは撮らない (成果物が増える割に (a) と重複するため)。 */
const SCREENSHOT_ROUTES: RouteKey[] = ['titles', 'events', 'venues', 'titleHub'];

let routes: Routes;

/** ページ内の `href` を集めて重複を除く。 */
async function hrefs(page: Page, pattern: RegExp): Promise<string[]> {
  const all = await page.$$eval('a[href]', (anchors) =>
    anchors.map((a) => a.getAttribute('href') ?? ''),
  );
  return [...new Set(all)].filter((href) => pattern.test(href));
}

/**
 * ルートを**実データから解決する**。slug や id を直書きしないのは、staging の
 * 中身が記事マージ (ingest) で入れ替わるため。解決できなければ**明示的に失敗**
 * させる (skip して静かに通すと、検証していないのに緑になる)。
 */
async function resolveRoutes(page: Page): Promise<Routes> {
  await page.setViewportSize({ width: 1280, height: 1000 });

  // 作品ハブ: 「開催一覧を見る」を持つ = 開催が 1 件以上ある作品を選ぶ。
  await page.goto('/titles');
  const titleHubs = await hrefs(page, /^\/titles\/[^/]+$/);
  expect(titleHubs.length, '/titles に作品リンクが無い (staging のデータを確認)').toBeGreaterThan(
    0,
  );

  let titleHub = '';
  let titleOccurrences = '';
  for (const href of titleHubs) {
    await page.goto(href);
    const found = await hrefs(page, /^\/titles\/[^/]+\/occurrences$/);
    if (found.length > 0) {
      titleHub = href;
      titleOccurrences = found[0];
      break;
    }
  }
  expect(titleHub, '開催を持つ作品が 1 件も見つからない').not.toBe('');

  // 企画 → その配下の開催詳細。
  await page.goto('/events');
  const eventDetails = await hrefs(page, /^\/events\/\d+$/);
  expect(eventDetails.length, '/events に企画リンクが無い').toBeGreaterThan(0);
  const eventDetail = eventDetails[0];

  await page.goto(eventDetail);
  const occurrences = await hrefs(page, /^\/events\/\d+\/[^/]+$/);
  expect(occurrences.length, `${eventDetail} に開催リンクが無い`).toBeGreaterThan(0);

  // 会場: 開催を 1 件以上持つ = グリッドが描かれている会場を選ぶ
  // (会場ページは開催 0 件でも生成されるため、先頭を無条件に採ると空を掴む)。
  await page.goto('/venues');
  const venueDetails = await hrefs(page, /^\/venues\/[^/]+$/);
  expect(venueDetails.length, '/venues に会場リンクが無い').toBeGreaterThan(0);

  let venueDetail = '';
  for (const href of venueDetails) {
    await page.goto(href);
    if ((await page.locator('[data-grid-cols]').count()) > 0) {
      venueDetail = href;
      break;
    }
  }
  expect(venueDetail, '開催を持つ会場が 1 件も見つからない').not.toBe('');

  return {
    titles: '/titles',
    events: '/events',
    venues: '/venues',
    titleHub,
    titleOccurrences,
    venueDetail,
    eventDetail,
    occurrenceDetail: occurrences[0],
  };
}

/**
 * `data-grid-cols` を持つ要素すべてについて「宣言列数」と「実際の grid track 数」を返す。
 *
 * ## computed 値の形が 2 通りある (実測 2026-08-25)
 *
 * Chrome の `getComputedStyle().gridTemplateColumns` は
 * **`repeat(2, minmax(0px, 1fr))` の形のまま返すことがある**。解決済みの
 * `"295px 295px 295px"` を前提に空白で分割すると `repeat(2,` / `minmax(0px,` /
 * `1fr))` の 3 要素になり、**3 列のグリッドが偶然一致して通ってしまう**
 * (初版の実装が実際にこれで空振りしていた)。両方の形を明示的に扱う。
 *
 * `display: grid` だけで列指定を持たない要素は `none` を返す。これは
 * 「列分岐が当たっていない = 1 カラム」を意味するので 1 に写す。
 * クラス名を綴り間違えた場合もここに落ちるため、宣言との差分で検出できる。
 */
function countTracks(template: string): number {
  const value = template.trim();
  if (value === 'none') return 1;
  const repeat = /^repeat\((\d+),/.exec(value);
  if (repeat) return Number(repeat[1]);
  return value.split(/\s+/).length;
}

async function measureGrids(page: Page): Promise<{ declared: number; actual: number }[]> {
  const raw = await page.$$eval('[data-grid-cols]', (elements) =>
    elements.map((el) => ({
      declared: Number(el.getAttribute('data-grid-cols')),
      template: getComputedStyle(el).gridTemplateColumns,
    })),
  );
  return raw.map(({ declared, template }) => ({ declared, actual: countTracks(template) }));
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    routes = await resolveRoutes(page);
  } finally {
    await page.close();
  }
});

for (const { key, width } of WIDTHS) {
  test(`列数: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });

    for (const [name, path] of Object.entries(routes) as [RouteKey, string][]) {
      await test.step(`${name} (${path})`, async () => {
        await page.goto(path);
        const grids = await measureGrids(page);

        // グリッドが 1 つも無い = セレクタが腐ったか、データが消えた。
        // どちらも「検証できていない」ので静かに通さず落とす。
        expect(grids.length, `${path} に [data-grid-cols] が無い`).toBeGreaterThan(0);

        for (const { declared, actual } of grids) {
          // sm(640) / md(768) / lg(1024) の順に効くため、
          //   375px  → どの分岐も当たらず 1 カラム
          //   768px  → 2 カラム (宣言が 1 のものは 1 のまま)
          //   1280px → 宣言どおり
          const expected =
            width < 640 ? 1 : width < 1024 ? Math.min(declared, 2) : declared;
          expect(actual, `${path}: 宣言 ${declared} 列のグリッド @${width}px`).toBe(expected);
        }
      });
    }
  });

  test(`スクリーンショット: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });

    for (const name of SCREENSHOT_ROUTES) {
      await test.step(`${name} (${routes[name]})`, async () => {
        await page.goto(routes[name]);

        // 🔴 **描画完了を待たないと `app/loading.tsx` のスピナーが焼き付く。**
        //    dev はオンデマンドコンパイルなので、初訪問のルートは `goto` の解決後も
        //    Suspense のフォールバックを出している。実際に 2026-08-25 の初回生成で
        //    /events /venues /titles/{slug} の 3 枚が**バイト単位で同一の
        //    スピナー画像**になった (先に列数テストで温まっていた /titles だけが
        //    本物だった)。グリッドの出現を待つことで、待機と
        //    「中身が描かれている」ことの表明を兼ねる。
        await expect(page.locator('[data-grid-cols]').first()).toBeVisible();

        await expect(page).toHaveScreenshot(`${name}-${key}.png`, {
          fullPage: true,
          mask: [page.locator(VOLATILE_MASK)],
        });
      });
    }
  });
}
