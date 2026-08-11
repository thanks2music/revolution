import { describe, expect, it } from '@jest/globals';

import { extractActualUrl, extractPageLinks, selectMainContent } from '@/lib/utils/html-extractor';

/**
 * `html-extractor.ts` にはこれまでテストが 1 本も無かった。ネットワークを叩く
 * 関数 (`extractArticleHtml` / `extractContentHtml`) は対象外とし、そこから
 * 切り出した純粋関数を Layer 1 として固定する。
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
    const result = selectMainContent(PAGE_WITH_CHROME);

    expect(result.strategy).toBe('largest-child');
    expect(result.selectedElement).toBe('div.page-content-wrapper');
    expect(result.html).toContain('Collabo_Index SHINSAIBASHI');
  });

  it('ページの外枠 (nav / header / footer / aside / form) を落とす', () => {
    // ★ 従来は script 系しか落としておらず、nav が 3 個そのまま LLM へ渡っていた。
    //   sw2026 では「TOKYO INFO / OSAKA INFO」というナビ文言だけが残り、
    //   抽出が「大阪があるらしい」と察して会場名を捏造する材料になっていた。
    const result = selectMainContent(PAGE_WITH_CHROME);

    expect(result.html).not.toContain('TOKYO INFO');
    expect(result.html).not.toContain('OSAKA INFO');
    expect(result.html).not.toContain('コピーライト表記');
    expect(result.html).not.toContain('tracking');
  });

  it('本文に必要な会場と期間は残す', () => {
    const result = selectMainContent(PAGE_WITH_CHROME);

    expect(result.html).toContain('BOX cafe&amp;space SHIBUYA109渋谷店');
    expect(result.html).toContain('2026年6月4日(木)〜2026年8月16日(日)');
    expect(result.html).toContain('2026年5月28日(木)〜2026年7月12日(日)');
  });

  it('body 直下が実質 1 個のページでも劣化しない', () => {
    // 「body 直下の div」ではなく「テキスト量が最大の要素」にした理由。
    // miku / nissy はこの形で、選んでも body 全体と実質同じ内容になる。
    const result = selectMainContent(PAGE_WITH_SINGLE_WRAPPER);

    expect(result.strategy).toBe('largest-child');
    expect(result.html).toContain('INFORMATION');
    expect(result.html).toContain('会場と期間の説明テキスト');
  });

  it('分割すると痩せる場合は body 全体へ倒す', () => {
    const result = selectMainContent(PAGE_WITH_TINY_CONTENT);

    expect(result.strategy).toBe('body');
    expect(result.selectedElement).toBeNull();
    // 両方のブロックが残ること (どちらか一方を選んで情報を捨てない)
    expect(result.html).toContain('短い');
    expect(result.html).toContain('これも短い');
  });

  it('テキスト量の推移を返す (ログで削減効果を確認するため)', () => {
    const result = selectMainContent(PAGE_WITH_CHROME);

    expect(result.bodyTextLength).toBeGreaterThan(0);
    expect(result.selectedTextLength).toBeGreaterThan(0);
    // 外枠を落としたぶん、選定後は body 以下になる
    expect(result.selectedTextLength).toBeLessThanOrEqual(result.bodyTextLength);
  });

  it('body が空でも throw しない', () => {
    const result = selectMainContent('<html><body></body></html>');
    expect(result.strategy).toBe('body');
    expect(result.html).toBe('');
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
