import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import * as cheerio from 'cheerio';

import {
  extractActualUrl,
  extractContentHtml,
  extractPageLinks,
  selectMainContent,
} from '@/lib/utils/html-extractor';

/**
 * `html-extractor.ts` にはこれまでテストが 1 本も無かった。純粋関数を Layer 1、
 * `extractContentHtml` の配線を `global.fetch` の mock で Layer 2 として固定する。
 *
 * `extractArticleHtml` は本 PR で意図的に変更していないため対象外 (別途 Layer 2 の課題)。
 *
 * fixture は LTR 系サイトの実構造を写したもの。`debug-logs/` の保存 HTML を
 * 読みに行くと gitignored なローカル成果物に依存して CI で落ちる。
 */

/** sw2026 / toy5 / kusuriya と同じ形。body 直下 8 個で、本文は `div.page-content-wrapper`。 */
const PAGE_WITH_CHROME = `
<!DOCTYPE html><html><head><title>「STAR WARS」CAFE</title></head>
<body>
  <header class="global-header"><h1>ロゴ</h1></header>
  <nav class="header__nav"><ul><li>TOKYO INFO</li><li>OSAKA INFO</li><li>RESERVATION</li></ul></nav>
  <div class="page-content-wrapper">
    <div class="info-container">
      <div class="place"><h2>TOKYO</h2>
        <p class="place_text_01">BOX cafe&amp;space SHIBUYA109渋谷店</p>
        <p class="place_text_02"><span>【開催期間】</span> 2026年6月4日(木)〜2026年8月16日(日)</p>
      </div>
      <div class="place"><h2>OSAKA</h2>
        <p class="place_text_01">Collabo_Index SHINSAIBASHI</p>
        <p class="place_text_02"><span>【開催期間】</span> 2026年5月28日(木)〜2026年7月12日(日)</p>
      </div>
    </div>
    <p>${'コラボカフェの本文テキストです。'.repeat(20)}</p>
  </div>
  <nav class="footer-fixed-nav"><a href="/reserve">予約</a></nav>
  <div class="reserve-modal">予約モーダル</div>
  <div class="info-modal">案内モーダル</div>
  <footer><p>コピーライト表記</p></footer>
  <script>console.log('tracking');</script>
</body></html>`;

/** miku / nissy と同じ形。body 直下が実質 1 個で、分割しても body 全体と変わらない。 */
const PAGE_WITH_SINGLE_WRAPPER = `
<!DOCTYPE html><html><head><title>初音ミク Wa Modern cafe</title></head>
<body>
  <div>
    <h1>INFORMATION</h1>
    <p>${'会場と期間の説明テキスト。'.repeat(30)}</p>
  </div>
</body></html>`;

/** 本文がほとんど無いページ。分割すると元より痩せるため body へ倒すべきケース。 */
const PAGE_WITH_TINY_CONTENT = `
<!DOCTYPE html><html><body>
  <div class="a">短い</div>
  <div class="b">これも短い</div>
</body></html>`;

describe('selectMainContent', () => {
  it('body 直下でテキスト量が最大の要素を選ぶ', () => {
    const result = selectMainContent(cheerio.load(PAGE_WITH_CHROME));

    expect(result.strategy).toBe('largest-child');
    expect(result.selectedElement).toBe('div.page-content-wrapper');
    expect(result.html).toContain('Collabo_Index SHINSAIBASHI');
  });

  it('ページの外枠 (nav / header / footer / aside / form) を落とす', () => {
    // ★ 従来は script 系しか落としておらず、nav が 3 個そのまま LLM へ渡っていた。
    //   sw2026 では「TOKYO INFO / OSAKA INFO」というナビ文言だけが残り、
    //   抽出が「大阪があるらしい」と察して会場名を捏造する材料になっていた。
    const result = selectMainContent(cheerio.load(PAGE_WITH_CHROME));

    expect(result.html).not.toContain('TOKYO INFO');
    expect(result.html).not.toContain('OSAKA INFO');
    expect(result.html).not.toContain('コピーライト表記');
    expect(result.html).not.toContain('tracking');
  });

  it('本文に必要な会場と期間は残す', () => {
    const result = selectMainContent(cheerio.load(PAGE_WITH_CHROME));

    expect(result.html).toContain('BOX cafe&amp;space SHIBUYA109渋谷店');
    expect(result.html).toContain('2026年6月4日(木)〜2026年8月16日(日)');
    expect(result.html).toContain('2026年5月28日(木)〜2026年7月12日(日)');
  });

  it('body 直下が実質 1 個のページでも劣化しない', () => {
    // 「body 直下の div」ではなく「テキスト量が最大の要素」にした理由。
    // miku / nissy はこの形で、選んでも body 全体と実質同じ内容になる。
    const result = selectMainContent(cheerio.load(PAGE_WITH_SINGLE_WRAPPER));

    expect(result.strategy).toBe('largest-child');
    expect(result.html).toContain('INFORMATION');
    expect(result.html).toContain('会場と期間の説明テキスト');
  });

  it('分割すると痩せる場合は body 全体へ倒す', () => {
    const result = selectMainContent(cheerio.load(PAGE_WITH_TINY_CONTENT));

    expect(result.strategy).toBe('body');
    expect(result.selectedElement).toBeNull();
    // 両方のブロックが残ること (どちらか一方を選んで情報を捨てない)
    expect(result.html).toContain('短い');
    expect(result.html).toContain('これも短い');
  });

  it('テキスト量の推移を返す (ログで削減効果を確認するため)', () => {
    const result = selectMainContent(cheerio.load(PAGE_WITH_CHROME));

    expect(result.bodyTextLength).toBeGreaterThan(0);
    expect(result.selectedTextLength).toBeGreaterThan(0);
    // 外枠を落としたぶん、選定後は body 以下になる
    expect(result.selectedTextLength).toBeLessThanOrEqual(result.bodyTextLength);
  });

  it('body が空でも throw しない', () => {
    const result = selectMainContent(cheerio.load('<html><body></body></html>'));
    expect(result.strategy).toBe('body');
    expect(result.html).toBe('');
  });

  it('class 属性が空白で始まっていてもラベルが壊れない', () => {
    // `class=" a b"` だと split の 1 要素目が空文字になり、ラベルが `div.` になる
    const html = `<html><body><div class="  main-content  extra">${'本文テキスト。'.repeat(40)}</div></body></html>`;
    const result = selectMainContent(cheerio.load(html));

    expect(result.selectedElement).toBe('div.main-content');
  });

  // ★ 挙動は変えず観測だけ増やす。片方を黙って捨てないことが目的。
  it('本文が兄弟要素に割れている場合は 2 位を runnerUp として返す', () => {
    const half = '本文の前半テキストです。'.repeat(30);
    const html = `<html><body>
      <div class="left">${half}</div>
      <div class="right">${half}</div>
    </body></html>`;
    const result = selectMainContent(cheerio.load(html));

    expect(result.strategy).toBe('largest-child');
    expect(result.runnerUp).toBeDefined();
    expect(result.runnerUp!.ratio).toBeGreaterThanOrEqual(0.8);
    // 選ばれたのは 1 位だけ = もう片方は捨てられている、という事実が残ること
    expect(result.runnerUp!.label).not.toBe(result.selectedElement);
  });

  it('2 位が十分小さければ runnerUp を付けない (通常のサイドバー等)', () => {
    const html = `<html><body>
      <div class="main">${'本文テキストです。'.repeat(50)}</div>
      <div class="side">補足</div>
    </body></html>`;
    const result = selectMainContent(cheerio.load(html));

    expect(result.selectedElement).toBe('div.main');
    expect(result.runnerUp).toBeUndefined();
  });

  it('渡した cheerio インスタンスを破壊的に変更する (docstring の契約)', () => {
    // 呼び出し元が head 情報を先に取り出す必要がある理由をテストで固定する。
    const $ = cheerio.load(PAGE_WITH_CHROME);
    expect($('footer').length).toBe(1);

    selectMainContent($);

    expect($('footer').length).toBe(0);
    expect($('nav').length).toBe(0);
  });
});

describe('extractActualUrl', () => {
  it('Google リダイレクト URL から実 URL を取り出す', () => {
    expect(extractActualUrl('https://www.google.com/url?url=https://example.com/article')).toBe(
      'https://example.com/article'
    );
  });

  it('通常の URL はそのまま返す', () => {
    expect(extractActualUrl('https://example.com/article')).toBe('https://example.com/article');
  });

  it('url パラメータが無い Google URL はそのまま返す', () => {
    const url = 'https://www.google.com/url?q=https://example.com';
    expect(extractActualUrl(url)).toBe(url);
  });
});

describe('extractPageLinks', () => {
  it('同一ドメインのリンクを絶対 URL で返す', () => {
    const html = `
      <a href="/lp/tokyo">TOKYO</a>
      <a href="/lp/osaka">OSAKA</a>
      <a href="https://example.com/lp/nagoya">NAGOYA</a>`;
    const links = extractPageLinks(html, 'https://example.com/');

    expect(links).toContain('https://example.com/lp/tokyo');
    expect(links).toContain('https://example.com/lp/osaka');
    expect(links).toContain('https://example.com/lp/nagoya');
  });
});

// ── extractContentHtml の配線 (Layer 2) ──────────────────────────────

/** `main` / `article` を持つ通常のページ。セレクタ命中経路。 */
const PAGE_WITH_MAIN = `
<!DOCTYPE html><html>
<head>
  <title>セレクタ命中ページ</title>
  <meta name="description" content="説明文">
  <meta property="og:title" content="OG タイトル">
</head>
<body>
  <header class="global-header">グローバルヘッダー</header>
  <main><p>${'main 要素の本文です。'.repeat(20)}</p></main>
  <footer>フッター</footer>
</body></html>`;

const originalFetch = global.fetch;

/** `fetchWithSSLFallback` は global fetch を呼ぶため、そこを差し替える。 */
function mockFetchHtml(html: string, init: { ok?: boolean; status?: number } = {}): void {
  global.fetch = jest.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: '',
    text: async () => html,
  })) as unknown as typeof global.fetch;
}

describe('extractContentHtml', () => {
  beforeEach(() => {
    // デバッグ保存が有効だと debug-logs/ へ書き込むため必ず無効にする
    delete process.env.DEBUG_HTML_EXTRACTION;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('セレクタが命中すればその innerHTML を返す', async () => {
    mockFetchHtml(PAGE_WITH_MAIN);

    const html = await extractContentHtml('https://example.com/');

    expect(html).toContain('main 要素の本文です。');
    // セレクタ経路では main の中身だけを返すため、外枠は入らない
    expect(html).not.toContain('グローバルヘッダー');
    expect(html).not.toContain('フッター');
  });

  // ★ head 情報の抽出を「除去より前」に置いた順序をテストで固定する。
  //   順序を入れ替えると title / og:* まで一緒に落ちる。
  it('フォールバック経路では head 情報を保持したまま外枠を落とす', async () => {
    mockFetchHtml(PAGE_WITH_CHROME);

    const html = await extractContentHtml('https://example.com/');

    // head 情報が残っていること
    expect(html).toContain('<title>「STAR WARS」CAFE</title>');
    // 本文が残っていること
    expect(html).toContain('BOX cafe&amp;space SHIBUYA109渋谷店');
    expect(html).toContain('Collabo_Index SHINSAIBASHI');
    // 外枠が落ちていること
    expect(html).not.toContain('TOKYO INFO');
    expect(html).not.toContain('コピーライト表記');
    expect(html).not.toContain('tracking');
  });

  it('meta description / og:* も head 情報として残す', async () => {
    // main を持たない形にして必ずフォールバック経路へ入れる
    const html = PAGE_WITH_MAIN.replace(/<main>/, '<div class="content">').replace(
      /<\/main>/,
      '</div>'
    );
    mockFetchHtml(html);

    const result = await extractContentHtml('https://example.com/');

    expect(result).toContain('og:title');
    expect(result).toContain('name="description"');
  });

  it('HTTP エラーは throw する (エラーページを本文にしない)', async () => {
    mockFetchHtml('<html><body>404</body></html>', { ok: false, status: 404 });

    await expect(extractContentHtml('https://example.com/missing')).rejects.toThrow(/404/);
  });
});
