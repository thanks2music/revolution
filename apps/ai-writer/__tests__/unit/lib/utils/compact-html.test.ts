/**
 * Layer 1: `compactHtmlForLlm` の純粋関数テスト。
 *
 * 本モジュールの目的は「15,000 文字の窓に入る情報量を増やす」ことであり、
 * **情報を減らさないこと**が最重要の不変条件。サイズが縮んでも会場名・日付・
 * リンクが消えたら本末転倒なので、削減とセットで保全を固定する。
 */
import {
  CHARS_PER_TOKEN_ESTIMATE,
  compactHtmlForLlm,
  LLM_INPUT_BUDGET_CHARS,
  NON_CONTENT_TOKENS_ESTIMATE,
  SMALLEST_CONTEXT_WINDOW_TOKENS,
} from '@/lib/utils/compact-html';

/**
 * 予算そのものの不変条件。
 *
 * `LLM_INPUT_BUDGET_CHARS` は 2025-12-08 から 2026-08-12 まで **根拠のないマジック
 * ナンバー (15,000)** のまま放置され、`conan-cafe.jp` で会場一覧が静かに切り捨てられる
 * 原因になった。同じ状態を再生産しないよう、**導出の前提が崩れたらテストが落ちる**
 * 形にしておく。
 */
describe('LLM_INPUT_BUDGET_CHARS の不変条件', () => {
  it('最小のコンテキスト窓に、テンプレートと出力を足しても収まる', () => {
    const contentTokens = LLM_INPUT_BUDGET_CHARS / CHARS_PER_TOKEN_ESTIMATE;
    const totalTokens = contentTokens + NON_CONTENT_TOKENS_ESTIMATE;

    expect(totalTokens).toBeLessThan(SMALLEST_CONTEXT_WINDOW_TOKENS);
  });

  it('最小のコンテキスト窓に対して十分な余裕 (50% 以上) を残す', () => {
    // 希釈リスクが未測定であるため、理論上限まで使い切らない方針を固定する。
    const contentTokens = LLM_INPUT_BUDGET_CHARS / CHARS_PER_TOKEN_ESTIMATE;
    const usageRatio = (contentTokens + NON_CONTENT_TOKENS_ESTIMATE) / SMALLEST_CONTEXT_WINDOW_TOKENS;

    expect(usageRatio).toBeLessThan(0.5);
  });

  it('conan-cafe.jp の圧縮前サイズ (35,344 文字) を包含する', () => {
    // 圧縮が将来退行しても会場一覧が届くことを保証する下限。
    // この値を下回ると Phase 3.7 で直した不具合が再発しうる。
    expect(LLM_INPUT_BUDGET_CHARS).toBeGreaterThanOrEqual(35_344);
  });
});

describe('compactHtmlForLlm', () => {
  describe('落とすもの', () => {
    it('script / style / noscript / svg / iframe を丸ごと落とす', () => {
      const html = `<div>
        <script>var a = 1;</script>
        <style>.x { color: red }</style>
        <noscript>JS を有効に</noscript>
        <svg><path d="M0 0"/></svg>
        <iframe src="https://example.com/map"></iframe>
        <p>本文</p>
      </div>`;
      const { html: out } = compactHtmlForLlm(html);

      expect(out).not.toContain('var a = 1');
      expect(out).not.toContain('color: red');
      expect(out).not.toContain('<svg');
      expect(out).not.toContain('<iframe');
      expect(out).toContain('本文');
    });

    it('HTML コメントを落とす', () => {
      const { html: out } = compactHtmlForLlm('<div><!-- 内部メモ --><p>本文</p></div>');

      expect(out).not.toContain('内部メモ');
      expect(out).toContain('本文');
    });

    it('class / style / data-* / srcset 等の属性を落とす', () => {
      const html =
        '<div class="a b c" style="color:red" data-foo="1" role="main" aria-label="x"><p>本文</p></div>';
      const { html: out } = compactHtmlForLlm(html);

      expect(out).not.toContain('class=');
      expect(out).not.toContain('style=');
      expect(out).not.toContain('data-foo');
      expect(out).not.toContain('role=');
      expect(out).not.toContain('aria-label');
      expect(out).toContain('本文');
    });

    it('テキストも構造も持たない要素を落とす', () => {
      const { html: out } = compactHtmlForLlm(
        '<div><span></span><div><span>  </span></div><p>本文</p></div>'
      );

      expect(out).toContain('本文');
      expect(out).not.toContain('<span>');
    });
  });

  describe('保持するもの (情報保全の境界)', () => {
    it('href を保持する — 会場一覧がリンク集で表現されるサイトがある', () => {
      // conan-cafe.jp / jujutsukaisen-cafe.jp / seventeen17-cafe.jp で実測した構造
      const html = `<ul>
        <li><a href="/information/shibuya" class="btn">渋谷</a></li>
        <li><a href="/information/osaka_kitte" class="btn">大阪KITTE</a></li>
      </ul>`;
      const { html: out } = compactHtmlForLlm(html);

      expect(out).toContain('/information/shibuya');
      expect(out).toContain('/information/osaka_kitte');
      expect(out).not.toContain('class=');
    });

    it('title / id を保持する', () => {
      const { html: out } = compactHtmlForLlm('<div id="venue" title="会場一覧"><p>本文</p></div>');

      expect(out).toContain('id="venue"');
      expect(out).toContain('title="会場一覧"');
    });

    it('img を [画像: alt] へ畳み、alt のテキストを残す', () => {
      const html =
        '<div><img src="https://static.example.com/very/long/path/image.jpg?auto=compress&ixlib=php-3.3.1" alt="BOX cafe&space GEMS渋谷店"></div>';
      const { html: out, textChars } = compactHtmlForLlm(html);

      expect(out).toContain('[画像: BOX cafe&space GEMS渋谷店]');
      expect(out).not.toContain('ixlib');
      expect(textChars).toBeGreaterThan(0);
    });

    it('alt を持たない img は要素ごと落とす', () => {
      const { html: out } = compactHtmlForLlm('<div><img src="https://x/y.jpg"><p>本文</p></div>');

      expect(out).not.toContain('<img');
      expect(out).not.toContain('[画像:');
      expect(out).toContain('本文');
    });

    it('table / br / hr を持つ要素は空とみなさず残す — 会場別期間は表で表現される', () => {
      const html = `<div><table><tr><th>会場</th><th>期間</th></tr>
        <tr><td>GEMS渋谷店</td><td>4月10日〜6月28日</td></tr>
        <tr><td>グランドスケープ池袋店</td><td>4月17日〜8月2日</td></tr></table></div>`;
      const { html: out } = compactHtmlForLlm(html);

      expect(out).toContain('<table');
      expect(out).toContain('GEMS渋谷店');
      expect(out).toContain('4月17日');
      expect(out).toContain('グランドスケープ池袋店');
    });

    it('見出し階層を保持する', () => {
      const { html: out } = compactHtmlForLlm(
        '<div class="w"><h2 class="t">開催情報</h2><h3>東京</h3></div>'
      );

      expect(out).toContain('<h2>開催情報</h2>');
      expect(out).toContain('<h3>東京</h3>');
    });
  });

  describe('単一子ラッパーの unwrap (最も効く処理)', () => {
    it('属性を持たない div/span の入れ子を平らにする', () => {
      const html = '<div><div><div><p>本文</p></div></div></div>';
      const { html: out, beforeChars, afterChars } = compactHtmlForLlm(html);

      expect(out).toBe('<p>本文</p>');
      expect(afterChars).toBeLessThan(beforeChars);
    });

    it('属性を持つラッパーは unwrap しない (意味を持つ可能性があるため)', () => {
      const { html: out } = compactHtmlForLlm('<div id="keep"><p>本文</p></div>');

      expect(out).toContain('id="keep"');
      expect(out).toContain('<p>本文</p>');
    });

    it('子が 2 つ以上あるラッパーは unwrap しない (兄弟関係が意味を持つ)', () => {
      const { html: out } = compactHtmlForLlm('<div><p>A</p><p>B</p></div>');

      expect(out).toContain('<div>');
      expect(out).toContain('A');
      expect(out).toContain('B');
    });

    it('テキストを直接持つ要素は unwrap しない', () => {
      const { html: out } = compactHtmlForLlm('<div>直接テキスト<p>子</p></div>');

      expect(out).toContain('直接テキスト');
      expect(out).toContain('子');
    });
  });

  describe('HTML エンティティの扱い', () => {
    it('会場名の & を保持する — cheerio の再エスケープを戻す', () => {
      // 実サイトは生の & で書いている (conan-cafe.jp で cafe&space 7 件 / &amp; 0 件)。
      // 既存記事 61 箇所も `BOX cafe&space` であり、&amp; が混じると venues の
      // 名寄せが壊れる。cheerio 1.2.0 は decodeEntities:false を無視するため明示的に戻す。
      const { html: out } = compactHtmlForLlm(
        '<div class="x"><p>BOX cafe&space GEMS渋谷店</p></div>'
      );

      expect(out).toContain('BOX cafe&space GEMS渋谷店');
      expect(out).not.toContain('&amp;');
    });

    it('入力が既に &amp; でも & へ正規化する', () => {
      const { html: out } = compactHtmlForLlm('<p>BOX cafe&amp;space HEP FIVE店</p>');

      expect(out).toContain('BOX cafe&space HEP FIVE店');
    });

    it('&lt; / &gt; は戻さない — 戻すと偽のタグになり構造が壊れる', () => {
      const { html: out } = compactHtmlForLlm('<p>条件は &lt;div&gt; 未満です</p>');

      expect(out).toContain('&lt;div&gt;');
      expect(out).not.toContain('<div>');
    });
  });

  describe('統計の返却値', () => {
    it('beforeChars / afterChars / textChars を返す', () => {
      const html = '<div class="a"><div class="b"><p>あいうえお</p></div></div>';
      const result = compactHtmlForLlm(html);

      expect(result.beforeChars).toBe(html.length);
      expect(result.afterChars).toBe(result.html.length);
      expect(result.afterChars).toBeLessThan(result.beforeChars);
      expect(result.textChars).toBe('あいうえお'.length);
    });

    it('圧縮の余地がない入力でも壊れない', () => {
      const result = compactHtmlForLlm('<p>本文</p>');

      expect(result.html).toBe('<p>本文</p>');
      expect(result.textChars).toBe(2);
    });

    it('空文字を渡しても throw しない', () => {
      const result = compactHtmlForLlm('');

      expect(result.html).toBe('');
      expect(result.beforeChars).toBe(0);
      expect(result.afterChars).toBe(0);
      expect(result.textChars).toBe(0);
    });
  });

  describe('実データに近い構造での不変条件', () => {
    /**
     * `conan-cafe.jp` の構造を模した fixture。深いラッパー div + 画像カルーセル +
     * 会場一覧リンク集という組み合わせが、密度 6.2% を生んでいた実態。
     */
    const REAL_SHAPE = `<div class="outer-wrap">
      <div class="inner"><div class="sec"><div class="ttl"><h2 class="h">開催情報</h2></div></div></div>
      <div class="slider"><ul class="slides">
        <li class="slide-img"><div class="img-box"><img src="https://static.hivelocity.co.jp/prod/content/uploads/2026/04/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg?auto=compress%2Cformat&ixlib=php-3.3.1" alt="アクリルスタンド（全7種）"></div>
          <div class="txt-box"><h2>アクリルスタンド（全7種）</h2><p><span>¥ 1,540</span>（税込）</p></div></li>
      </ul></div>
      <div class="venues"><ul>
        <li><a href="/information/shibuya" class="c-btn"><div class="in"><span>BOX cafe&space GEMS渋谷店</span></div></a></li>
        <li><a href="/information/ikebukuro" class="c-btn"><div class="in"><span>BOX cafe&space グランドスケープ池袋店</span></div></a></li>
      </ul>
      <p>2026年4月10日 (金) 〜 2026年6月28日 (日)</p>
      <p>2026年4月17日 (金) 〜 2026年8月2日 (日)</p></div>
    </div>`;

    it('会場名・日付・会場別リンクを 1 つも失わない', () => {
      const { html: out } = compactHtmlForLlm(REAL_SHAPE);

      for (const keep of [
        'BOX cafe&space GEMS渋谷店',
        'BOX cafe&space グランドスケープ池袋店',
        '/information/shibuya',
        '/information/ikebukuro',
        '2026年4月10日',
        '2026年6月28日',
        '2026年4月17日',
        '2026年8月2日',
        '開催情報',
        'アクリルスタンド（全7種）',
      ]) {
        expect(out).toContain(keep);
      }
    });

    it('密度が大幅に上がる (実測では 6.2% → 35.8%)', () => {
      const { beforeChars, afterChars, textChars } = compactHtmlForLlm(REAL_SHAPE);

      const densityBefore = 0; // 参照用: 元の密度は下の期待値で間接的に担保する
      void densityBefore;

      expect(afterChars).toBeLessThan(beforeChars * 0.6);
      // 圧縮後の密度が 20% を超えること (元は 10% 未満)
      expect(textChars / afterChars).toBeGreaterThan(0.2);
    });

    it('2 回適用しても結果が変わらない (冪等)', () => {
      const once = compactHtmlForLlm(REAL_SHAPE).html;
      const twice = compactHtmlForLlm(once).html;

      expect(twice).toBe(once);
    });
  });
});
