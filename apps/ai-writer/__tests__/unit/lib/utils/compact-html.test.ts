/**
 * Layer 1: `compactHtmlForLlm` の純粋関数テスト。
 *
 * 本モジュールの目的は「`LLM_INPUT_BUDGET_CHARS` の窓に入る情報量を増やす」ことであり、
 * **情報を減らさないこと**が最重要の不変条件。サイズが縮んでも会場名・日付・
 * リンクが消えたら本末転倒なので、削減とセットで保全を固定する。
 */
import { DEFAULT_CLAUDE_MODEL } from '@/lib/config/claude-models';
import {
  CHARS_PER_TOKEN_ESTIMATE,
  CHARS_PER_TOKEN_WORST_CASE,
  compactHtmlForLlm,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_TEMPLATE_TOKENS_ESTIMATE,
  LLM_INPUT_BUDGET_CHARS,
  NON_CONTENT_TOKENS_ESTIMATE,
  SMALLEST_CONTEXT_WINDOW_TOKENS,
  truncateForLlm,
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
  // ⚠️ 次の 2 件は現在の値では前者が後者に数学的に含意される (0.5 × 窓 < 窓)。
  //    それでも両方置くのは、表しているものが違うため。
  //    - 1 件目 = **ハード制約** (窓に収まらなければ API が拒否する)
  //    - 2 件目 = **方針** (希釈リスクが未測定なので使い切らない)
  //    将来 2 件目の閾値を 0.8 等に緩めたときに 1 件目だけが残って効く。
  //    方針を緩める判断とハード制約を混ぜないため、意図的に分けている。
  it('[ハード制約] 最小のコンテキスト窓に、テンプレートと出力を足しても収まる', () => {
    // ★ 平均 (1.96) ではなく観測最小 (1.88) を使う。chars/token が小さいほど同じ
    //   文字数でより多くのトークンを消費するため、制約の検証には最悪値が正しい。
    const contentTokens = LLM_INPUT_BUDGET_CHARS / CHARS_PER_TOKEN_WORST_CASE;
    const totalTokens = contentTokens + NON_CONTENT_TOKENS_ESTIMATE;

    expect(totalTokens).toBeLessThan(SMALLEST_CONTEXT_WINDOW_TOKENS);
  });

  it('[方針] 最小のコンテキスト窓の 50% 未満に留める', () => {
    // 希釈リスクが未測定であるため、理論上限まで使い切らない方針を固定する。
    const contentTokens = LLM_INPUT_BUDGET_CHARS / CHARS_PER_TOKEN_WORST_CASE;
    const usageRatio =
      (contentTokens + NON_CONTENT_TOKENS_ESTIMATE) / SMALLEST_CONTEXT_WINDOW_TOKENS;

    expect(usageRatio).toBeLessThan(0.5);
  });

  it('conan-cafe.jp の圧縮前サイズ (35,344 文字) を包含する', () => {
    // 圧縮が将来退行しても会場一覧が届くことを保証する下限。
    // この値を下回ると Phase 3.7 で直した不具合が再発しうる。
    expect(LLM_INPUT_BUDGET_CHARS).toBeGreaterThanOrEqual(35_344);
  });

  it('NON_CONTENT_TOKENS_ESTIMATE は内訳から導出され、リテラルではない', () => {
    // extraction.service.ts の maxTokens を変えたら自動的にここも変わり、
    // 上の [ハード制約] / [方針] が再評価されることを保証する。
    // リテラル 28_000 に戻すと maxTokens 変更時に drift するため、構造を固定する。
    expect(NON_CONTENT_TOKENS_ESTIMATE).toBe(
      EXTRACTION_TEMPLATE_TOKENS_ESTIMATE + EXTRACTION_MAX_OUTPUT_TOKENS
    );
  });

  it('平均と観測最悪値が「最悪値のほうが多くのトークンを消費する」関係にある', () => {
    // 逆転していると [ハード制約] テストが甘くなるため、関係自体を固定する。
    expect(CHARS_PER_TOKEN_WORST_CASE).toBeLessThan(CHARS_PER_TOKEN_ESTIMATE);
    expect(LLM_INPUT_BUDGET_CHARS / CHARS_PER_TOKEN_WORST_CASE).toBeGreaterThan(
      LLM_INPUT_BUDGET_CHARS / CHARS_PER_TOKEN_ESTIMATE
    );
  });

  /**
   * `SMALLEST_CONTEXT_WINDOW_TOKENS` が既定の Anthropic モデルから機械的に導かれて
   * いないことへの歯止め (drift guard)。
   *
   * 既定モデルが別の窓サイズのものへ変われば `SMALLEST_CONTEXT_WINDOW_TOKENS` も
   * 変わるべきだが、両者はコード上つながっていない。**放置すると本 PR が
   * `LLM_INPUT_BUDGET_CHARS` について直したのと同じ「根拠が実態から剥がれる」状態**に
   * なるため、モデル名を固定してテストを落とす形で再確認を強制する。
   *
   * このテストが落ちたら: 新しいモデルの公式コンテキスト窓を確認し、
   * `SMALLEST_CONTEXT_WINDOW_TOKENS` と本テストの期待値を同時に更新する。
   */
  it('[drift guard] 既定の Anthropic モデルが変わったら窓サイズの再確認を強制する', () => {
    // claude-sonnet-4-5 = 200,000 tokens
    // https://platform.claude.com/docs/en/build-with-claude/context-windows
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-sonnet-4-5-20250929');
    expect(SMALLEST_CONTEXT_WINDOW_TOKENS).toBe(200_000);
  });
});

/**
 * `truncateForLlm` の Layer 1 テスト。
 *
 * `extraction.service.truncation.test.ts` (Layer 2) が消費側の境界を固定しているが、
 * **純粋関数としての契約はここで直接固める**。DI やプロンプト構築を経由しないため、
 * 何を保証しているかが読み取りやすい。
 */
describe('truncateForLlm', () => {
  it('予算未満はそのまま返し、truncated=false', () => {
    const r = truncateForLlm('あいうえお', 10);

    expect(r.text).toBe('あいうえお');
    expect(r.truncated).toBe(false);
  });

  it('予算とちょうど同じ長さは切り詰めない (off-by-one)', () => {
    const r = truncateForLlm('あいうえお', 5);

    expect(r.text).toBe('あいうえお');
    expect(r.truncated).toBe(false);
  });

  it('予算を 1 超えたら切り詰め、truncated=true', () => {
    const r = truncateForLlm('あいうえお', 4);

    expect(r.text).toBe('あいうえ');
    expect(r.truncated).toBe(true);
  });

  it('サロゲートペアの内側で切らない — 1 コードユニット戻す', () => {
    // 'あ🎉いう' のコードユニット構成 (実測):
    //   [0] 0x3042 あ / [1] 0xD83C 上位 / [2] 0xDF89 下位 / [3] 0x3044 い / [4] 0x3046 う
    // 予算 2 だと [1] の直後 = ペアの内側で切れる。
    const r = truncateForLlm('あ🎉いう', 2);

    expect(r.truncated).toBe(true);
    expect(r.text).toBe('あ'); // ペアを割らず 1 戻した結果
    expect(r.text).toHaveLength(1);
    // 孤立した上位サロゲートが残っていないこと
    const last = r.text.charCodeAt(r.text.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it('サロゲートペアの境界とちょうど一致する場合は戻さない', () => {
    // 予算 3 = [0]あ + [1]上位 + [2]下位 → ペアが完全に収まるので調整不要
    const r = truncateForLlm('あ🎉いう', 3);

    expect(r.truncated).toBe(true);
    expect(r.text).toBe('あ🎉');
    expect(r.text).toHaveLength(3);
  });

  it('既定値は LLM_INPUT_BUDGET_CHARS を使う', () => {
    // 呼び出し側がリテラルを書かなくて済むことを固定する。
    const r = truncateForLlm('あ'.repeat(LLM_INPUT_BUDGET_CHARS + 1));

    expect(r.truncated).toBe(true);
    expect(r.text).toHaveLength(LLM_INPUT_BUDGET_CHARS);
  });

  it('空文字を渡しても throw しない', () => {
    const r = truncateForLlm('', 10);

    expect(r.text).toBe('');
    expect(r.truncated).toBe(false);
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
