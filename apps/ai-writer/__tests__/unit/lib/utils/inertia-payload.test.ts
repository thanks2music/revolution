import { describe, expect, it } from '@jest/globals';
import * as cheerio from 'cheerio';

import { expandInertiaPayload, extractInertiaMarkup } from '@/lib/utils/inertia-payload';

/** Inertia の root 要素を組み立てる (属性値は JSON をエンティティ escape したもの)。 */
function buildInertiaHtml(page: unknown, bodyText = ''): string {
  const json = JSON.stringify(page)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><body>${bodyText}<div id="app" data-page="${json}"></div></body></html>`;
}

describe('extractInertiaMarkup', () => {
  it('Inertia でない HTML では null を返す', () => {
    expect(extractInertiaMarkup('<html><body><p>本文</p></body></html>')).toBeNull();
  });

  it('data-page が壊れた JSON なら null を返す (復元を諦めるだけで落ちない)', () => {
    const html = '<div id="app" data-page="{ not json }"></div>';
    expect(extractInertiaMarkup(html)).toBeNull();
  });

  it('HTML タグを含む文字列だけを復元する', () => {
    const html = buildInertiaHtml({
      component: 'TopPage',
      props: {
        title: 'ただのラベル',
        content: { body: '<div class="place"><p class="place_text_01">BOX cafe 池袋店</p></div>' },
      },
    });

    const markup = extractInertiaMarkup(html);
    expect(markup).toContain('place_text_01');
    expect(markup).not.toContain('ただのラベル');
  });

  // ★ props.content.css は実測 23,740 字あり、これを混ぜると LLM の入力枠を食い潰す。
  //   HTML タグ判定で自然に落ちることを固定する。
  it('CSS 文字列は復元対象に含めない', () => {
    const html = buildInertiaHtml({
      props: {
        content: {
          body: '<div class="place">会場</div>',
          css: 'body { font-family: "游ゴシック"; margin: 0; }',
        },
      },
    });

    const markup = extractInertiaMarkup(html);
    expect(markup).toContain('place');
    expect(markup).not.toContain('font-family');
  });

  it('同一マークアップが複数箇所にあっても重複を除く', () => {
    const frag = '<div class="place">同じ</div>';
    const html = buildInertiaHtml({ props: { a: frag, b: frag } });

    expect(extractInertiaMarkup(html)).toBe(frag);
  });

  it('HTML を含む文字列が 1 つも無ければ null', () => {
    const html = buildInertiaHtml({ props: { a: 'ラベル', b: 'もう 1 つ' } });
    expect(extractInertiaMarkup(html)).toBeNull();
  });

  it('配列・入れ子を再帰的に辿る', () => {
    const html = buildInertiaHtml({
      props: { widgets: [{ content: { body: '<section><h2>TOKYO</h2></section>' } }] },
    });

    expect(extractInertiaMarkup(html)).toContain('<h2>TOKYO</h2>');
  });
});

describe('expandInertiaPayload', () => {
  it('Inertia でない HTML は変更しない (非 Inertia サイトへの副作用ゼロ)', () => {
    const html = '<html><body><p>本文</p></body></html>';
    expect(expandInertiaPayload(html)).toBe(html);
  });

  it('復元したマークアップを追記する (元の DOM は失わない)', () => {
    const html = buildInertiaHtml(
      { props: { content: { body: '<div class="place">会場A</div>' } } },
      '<p>SSR 側の本文</p>'
    );

    const expanded = expandInertiaPayload(html);

    expect(expanded).toContain('SSR 側の本文'); // 元の内容が残る
    expect(expanded).toContain('会場A'); // 復元分が足される
    expect(expanded.length).toBeGreaterThan(html.length);
  });

  it('展開後は cheerio で .place を選択できる (ゲートが measure 可能になる)', () => {
    const html = buildInertiaHtml({
      props: {
        content: {
          body: [
            '<div class="place"><h2>TOKYO</h2><p class="place_text_01">BOX cafe&space グランドスケープ池袋店</p></div>',
            '<div class="place"><h2>NAGOYA</h2><p class="place_text_01">BOX cafe&space グローバルゲート名古屋2号店</p></div>',
            '<div class="place"><h2>OSAKA</h2><p class="place_text_01">BOX cafe&space 天王寺MIO店</p></div>',
          ].join(''),
        },
      },
    });

    const $ = cheerio.load(expandInertiaPayload(html));

    expect($('.place')).toHaveLength(3);
    expect($('.place_text_01').first().text()).toBe('BOX cafe&space グランドスケープ池袋店');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 回帰テスト: 2026-08-15 の実走で捏造記事を生んだ実データの構造を再現する。
//
// miku-wa-modern-cafe / nissy-cafe-2026 は生 HTML の本文が 19 字 / 38 字しか無く、
// LLM がページタイトルだけを頼りに記事を書いていた。展開すれば会場も日程も取れる。
// ────────────────────────────────────────────────────────────────────────────
describe('実走で捏造を生んだ構造 (回帰)', () => {
  const realShape = {
    component: 'TopPage',
    props: {
      stores: [
        { name: 'BOX cafe&space グランドスケープ池袋店' },
        { name: 'BOX cafe&space グローバルゲート名古屋2号店' },
        { name: 'BOX cafe&space 天王寺MIO店' },
      ],
      initial: {
        topContentWidgets: [
          {
            content: {
              body:
                '<div class="info-container">' +
                '<div class="place"><h2>TOKYO</h2>' +
                '<p class="place_text_01">BOX cafe&space グランドスケープ池袋店</p>' +
                '<p class="place_text_02"><span>【開催期間】</span> 2026年8月7日(金)〜2026年9月27日(日)</p>' +
                '</div></div>',
              css: 'body { font-family: sans-serif; }',
            },
          },
        ],
      },
    },
  };

  it('生 HTML の本文が空でも、展開すれば会場と開催期間が復元できる', () => {
    // 実サイトと同じく body には題名しか無い状態
    const html = buildInertiaHtml(realShape, '初音ミク Wa Modern cafe');

    const $ = cheerio.load(expandInertiaPayload(html));

    expect($('.place')).toHaveLength(1);
    expect($('.place_text_01').text()).toBe('BOX cafe&space グランドスケープ池袋店');
    expect($('.place_text_02').text()).toContain('2026年8月7日');
  });

  it('展開前は .place が 0 件 = ゲートが unmeasured になっていた', () => {
    const html = buildInertiaHtml(realShape, '初音ミク Wa Modern cafe');

    // 展開しないと data-page は属性のままなので要素として選択できない
    expect(cheerio.load(html)('.place')).toHaveLength(0);
  });
});
