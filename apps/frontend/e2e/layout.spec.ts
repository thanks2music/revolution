import { expect, test, type Page } from '@playwright/test';

import { countTracks } from './grid-tracks';

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
 * ## 検証の仕組み: レイアウト種別の宣言 × ブレークポイント境界
 *
 * 各グリッドは `data-grid-layout` で**どのレイアウト種別か**を宣言し、
 * spec 側が「種別 × 幅 → 期待列数」の表 (`LAYOUTS`) を持つ。実測値は
 * Tailwind が実際に生成した grid track 数なので、宣言と結果は出どころが違う。
 *
 * ### なぜ「最大列数」ではなく「種別」を宣言するのか (2026-08-25 改訂)
 *
 * 初版は `data-grid-cols="3"` のように**最大列数**を宣言していたが、それだと
 * **その 2 列化が `sm:` なのか `md:` なのかを表現できない**。768px では sm と md が
 * 両方有効なので、以下がすべて素通りしていた (Codex / claude-review 指摘):
 *
 * | 誤変更 | 実害 | 初版 (375/768/1280) |
 * |---|---|---|
 * | `sm:grid-cols-2` を `md:grid-cols-2` へ | 640〜767px が 1 列へ後退 | **通ってしまう** |
 * | `lg:grid-cols-3` を `xl:grid-cols-3` へ | 1024〜1279px が 2 列へ後退 | **通ってしまう** |
 *
 * 種別を宣言し、**境界の両側** (639/640, 767/768, 1023/1024) を測ればどちらも落ちる。
 * 種別は現時点で実在する 3 つだけを列挙しており、将来のための抽象化ではない。
 *
 * ### 「自作自演」ではない理由
 *
 * 宣言は**意図**、track 数は**Tailwind が生成した結果**。よって
 * `lg:grid-col-3` のような綴り間違いでクラスが無効化され、黙って 1 カラムに戻る
 * 事故を検出できる。これは `animate-[…]` が存在しない `@keyframes` を参照しても
 * ビルドが通り、全ページでドットが静止していた 2026-08-22 の事故と同型の失敗
 * モードで、tsc / eslint / 既存テストのいずれも捕まえられない。
 *
 * ⚠️ 検査テストを足したら **mutation test で実効性を確かめること**。
 *
 * ## 🔴 実行前提
 *
 * **staging を向いた dev サーバが `localhost:4444` で起動していること。**
 * 素の `pnpm dev` は production の Supabase を向いてデータが空になるため
 * 検証にならない。起動手順は `playwright.config.ts` の docstring を参照。
 *
 * 基準画像は gitignored なので、**clone 直後や新しいマシンでは必ず**
 * `pnpm test:visual --update-snapshots` を一度回して自分の基準を作る。
 * 列数アサーションだけなら `pnpm test:visual --grep 列数` で基準画像は要らない。
 */

/**
 * レイアウト種別から幅ごとの期待列数を引く表。
 *
 * Tailwind の既定ブレークポイント (sm=640 / md=768 / lg=1024) に対応する。
 * **ここが列数仕様の真実源**で、グリッドを追加するときは種別を 1 つ選ぶ。
 * 新しい列パターンが要るなら、既存種別を歪めずに種別を足すこと。
 */
const LAYOUTS = {
  /** 意図的に 1 カラムのまま。複合カード (中に別のリストを内包する) 用。 */
  single: () => 1,
  /** 縦積みカードと短い 1〜2 行。`sm:grid-cols-2 lg:grid-cols-3`。 */
  block: (width: number) => (width < 640 ? 1 : width < 1024 ? 2 : 3),
  /** 横 1 行型カード (`OccurrenceCard`)。`md:grid-cols-2` 止まり。 */
  row: (width: number) => (width < 768 ? 1 : 2),
} satisfies Record<string, (width: number) => number>;

type LayoutKind = keyof typeof LAYOUTS;

const isLayoutKind = (value: string): value is LayoutKind => value in LAYOUTS;

/**
 * 検証する幅。**ブレークポイントの両側を測る**のが要点で、
 * サンプル 3 点だけでは境界の付け替えを検出できない (上記の表)。
 */
const WIDTHS = [375, 639, 640, 767, 768, 1023, 1024, 1280] as const;

/** スクリーンショットを撮る幅 (全 8 幅は撮らない。基準画像は gitignored な補助層のため)。 */
const SCREENSHOT_WIDTHS = [
  { key: 'mobile', width: 375 },
  { key: 'tablet', width: 768 },
  { key: 'desktop', width: 1280 },
] as const;

/**
 * 日付をまたぐだけで中身が変わる表示。スクリーンショットから除外する。
 * 現状は残日数バッジ (`RemainingDaysBadge`) のみ。
 */
const VOLATILE_MASK = '[data-volatile]';

const GRID = '[data-grid-layout]';

type RouteKey =
  | 'titles'
  | 'events'
  | 'venues'
  | 'titleHub'
  | 'titleOccurrences'
  | 'venueDetail'
  | 'eventDetail'
  | 'occurrenceDetail';

/**
 * ルートごとに**必ず存在するはずの**レイアウト種別。
 *
 * 属性が消えるとそのグリッドは測定対象から外れるため、「1 つ以上ある」だけでは
 * カバレッジの欠落に気づけない (Codex 指摘)。ただしデータ次第で消えるセクション
 * (関連企画など) は要求しない — 存在すれば各要素の突き合わせで検証される。
 */
const REQUIRED_LAYOUTS: Record<RouteKey, LayoutKind[]> = {
  titles: ['block'],
  events: ['block'],
  venues: ['block'],
  // 外側の「この作品の企画」= single、その中の開催リスト = row。
  titleHub: ['single', 'row'],
  titleOccurrences: ['block'],
  venueDetail: ['block'],
  // 「会場を選ぶ」= row。関連企画 (block) は同じ作品に別企画が無いと出ないので要求しない。
  eventDetail: ['row'],
  // 「この企画の他の開催」= row。`resolveRoutes` が開催 2 件以上の企画を選ぶ。
  occurrenceDetail: ['row'],
};

type Routes = Record<RouteKey, string>;

/** 候補を総当たりする際の上限。データが増えても beforeAll が伸び続けないようにする。 */
const RESOLVE_SCAN_LIMIT = 15;

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
 *
 * ⚠️ 条件付きセクションを持つデータを選ぶこと。例えば開催詳細の
 *    「この企画の他の開催」は**兄弟開催があるときだけ**描かれるので、開催が
 *    1 件しか無い企画を掴むと、レイアウト回帰でないのにテストが落ちる
 *    (Codex 指摘。`/events` に載る条件は「開催 1 件以上」であって 2 件以上ではない)。
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
  for (const href of titleHubs.slice(0, RESOLVE_SCAN_LIMIT)) {
    await page.goto(href);
    const found = await hrefs(page, /^\/titles\/[^/]+\/occurrences$/);
    if (found.length > 0) {
      titleHub = href;
      titleOccurrences = found[0];
      break;
    }
  }
  expect(titleHub, '開催を持つ作品が 1 件も見つからない').not.toBe('');

  // 企画: **開催 2 件以上**を持つものを選ぶ (開催詳細の「この企画の他の開催」を
  // 検証するため)。1 件だけの企画を掴むと、正常なページなのに落ちる。
  await page.goto('/events');
  const eventCandidates = await hrefs(page, /^\/events\/\d+$/);
  expect(eventCandidates.length, '/events に企画リンクが無い').toBeGreaterThan(0);

  let eventDetail = '';
  let occurrenceDetail = '';
  for (const href of eventCandidates.slice(0, RESOLVE_SCAN_LIMIT)) {
    await page.goto(href);
    const occurrences = await hrefs(page, /^\/events\/\d+\/[^/]+$/);
    if (occurrences.length >= 2) {
      eventDetail = href;
      occurrenceDetail = occurrences[0];
      break;
    }
  }
  expect(
    eventDetail,
    '開催を 2 件以上持つ企画が見つからない (「この企画の他の開催」を検証できる fixture が無い)',
  ).not.toBe('');

  // 会場: 開催を 1 件以上持つ = グリッドが描かれている会場を選ぶ
  // (会場ページは開催 0 件でも生成されるため、先頭を無条件に採ると空を掴む)。
  await page.goto('/venues');
  const venueCandidates = await hrefs(page, /^\/venues\/[^/]+$/);
  expect(venueCandidates.length, '/venues に会場リンクが無い').toBeGreaterThan(0);

  let venueDetail = '';
  for (const href of venueCandidates.slice(0, RESOLVE_SCAN_LIMIT)) {
    await page.goto(href);
    if ((await page.locator(GRID).count()) > 0) {
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
    occurrenceDetail,
  };
}

/**
 * ページを開き、**描画完了を待ってから** グリッドを測る。
 *
 * 🔴 待たないと `app/loading.tsx` のフォールバックを測ってしまう。dev は
 *    オンデマンドコンパイルなので、初訪問のルートは `goto` の解決後も
 *    Suspense のフォールバックを出している (2026-08-25 実測: スクリーンショットの
 *    初回生成で 3 枚がバイト単位で同一のスピナー画像になった)。
 */
async function openAndMeasure(
  page: Page,
  path: string,
): Promise<{ kind: LayoutKind; actual: number }[]> {
  await page.goto(path);
  await expect(page.locator(GRID).first()).toBeVisible();

  const raw = await page.$$eval('[data-grid-layout]', (elements) =>
    elements.map((el) => ({
      kind: el.getAttribute('data-grid-layout') ?? '',
      template: getComputedStyle(el).gridTemplateColumns,
    })),
  );

  return raw.map(({ kind, template }) => {
    // 未知の種別 = 宣言のタイポ。期待値が引けないので静かに飛ばさず落とす。
    expect(isLayoutKind(kind), `${path}: 未知の data-grid-layout="${kind}"`).toBe(true);
    return { kind: kind as LayoutKind, actual: countTracks(template) };
  });
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    routes = await resolveRoutes(page);
  } finally {
    await page.close();
  }
});

for (const width of WIDTHS) {
  test(`列数: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });

    for (const [name, path] of Object.entries(routes) as [RouteKey, string][]) {
      await test.step(`${name} (${path})`, async () => {
        const grids = await openAndMeasure(page, path);

        // 属性が消えるとそのグリッドは測定対象から外れる。ルートごとに
        // 「必ずあるはずの種別」を要求して、カバレッジの欠落に気づけるようにする。
        const kinds = grids.map((grid) => grid.kind);
        for (const required of REQUIRED_LAYOUTS[name]) {
          expect(kinds, `${path} に data-grid-layout="${required}" が無い`).toContain(required);
        }

        for (const { kind, actual } of grids) {
          expect(actual, `${path}: ${kind} レイアウト @${width}px`).toBe(LAYOUTS[kind](width));
        }
      });
    }
  });
}

for (const { key, width } of SCREENSHOT_WIDTHS) {
  test(`スクリーンショット: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });

    // 全 8 ルートは撮らない (成果物が増える割に列数アサーションと重複するため)。
    const targets: RouteKey[] = ['titles', 'events', 'venues', 'titleHub'];
    for (const name of targets) {
      await test.step(`${name} (${routes[name]})`, async () => {
        await page.goto(routes[name]);
        await expect(page.locator(GRID).first()).toBeVisible();

        await expect(page).toHaveScreenshot(`${name}-${key}.png`, {
          fullPage: true,
          mask: [page.locator(VOLATILE_MASK)],
        });
      });
    }
  });
}
