import { describe, expect, it } from '@jest/globals';

import {
  buildFactLines,
  cleanFeatures,
  countGoods,
  formatPeriod,
  formatGoodsLine,
  formatPlace,
  joinArticleParts,
  noveltyContextMentionsRedrawn,
  renderArticlePoints,
  type PointsFactsInput,
  type PointsFormat,
} from '@/lib/services/article-points';

/**
 * Layer 1: 「この記事のポイント」の事実の行と枠 (2026-10-15)。
 * 書式は Templates の sections/01b-points.yaml の rendered と同じ値 (Templates は CI に無いので、ここに写す)
 */
const FORMAT: PointsFormat = {
  date: '{{year}}年{{month}}月{{day}}日',
  date_same_year: '{{month}}月{{day}}日',
  period: '{{start}}〜{{end}}',
  period_open: '{{start}}〜',
  place_single: '{{venue}}',
  place_multi: "{{cities|join:'・'}}の{{count}}会場",
  place_multi_count_only: '全{{count}}会場',
  schedule_line: '{{#if period}}{{period}}{{/if}}{{#if both}}、{{/if}}{{#if place}}{{place}}{{/if}}',
  redrawn_line: '{{word}}イラストを使用',
  // グッズの行の文面は Templates が持つ (public な revolution には書かない)。ここでは差し込む値だけを確かめる
  goods_line_many: "GOODS_MANY:{{count}}{{#if channels}}({{channels|join:'/'}}){{/if}}",
  goods_line_few: "GOODS_FEW{{#if channels}}({{channels|join:'/'}}){{/if}}",
  goods_channel_store: '店舗',
  goods_channel_online: 'オンライン',
  menu_line: 'コラボメニュー全{{count}}品',
  novelty_line: "ノベルティ：{{names|join:'、'}}",
};

const BASE: PointsFactsInput = {
  period: {},
  venues: [],
  cities: [],
  redrawnWord: null,
  goodsNames: null,
  goodsDetails: null,
  menuCount: 0,
  noveltyNames: null,
  noveltyRedrawn: false,
};

describe('formatPeriod', () => {
  it('同じ年なら終了の年を省く (期間は全会場の和集合を呼び出し側が渡す)', () => {
    expect(formatPeriod({ start: '2026-10-16', end: '2026-12-20' }, FORMAT)).toBe('2026年10月16日〜12月20日');
  });

  it('年をまたげば終了にも年を書く', () => {
    expect(formatPeriod({ start: '2026-12-05', end: '2027-01-12' }, FORMAT)).toBe('2026年12月5日〜2027年1月12日');
  });

  it('終了日が無ければ終わりを書かない', () => {
    expect(formatPeriod({ start: '2026-10-16' }, FORMAT)).toBe('2026年10月16日〜');
  });

  it('開始日が無い・形が違えば null (日程が未発表の記事)', () => {
    expect(formatPeriod({}, FORMAT)).toBeNull();
    expect(formatPeriod({ end: '2026-12-20' }, FORMAT)).toBeNull();
    expect(formatPeriod({ start: '10月16日' }, FORMAT)).toBeNull();
  });
});

describe('formatPlace', () => {
  it('会場が 1 つなら会場名 (MDX として安全にする)', () => {
    expect(formatPlace(['BOX cafe&space <池袋>'], ['東京'], FORMAT)).toBe('BOX cafe&space &#60;池袋&#62;');
  });

  it('2 つ以上なら開催地と会場の数', () => {
    expect(formatPlace(['a', 'b', 'c', 'd'], ['東京', '愛知', '大阪', '北海道'], FORMAT)).toBe('東京・愛知・大阪・北海道の4会場');
  });

  it('開催地が分からなければ数だけ。会場が無ければ null', () => {
    expect(formatPlace(['a', 'b'], [], FORMAT)).toBe('全2会場');
    expect(formatPlace([], ['東京'], FORMAT)).toBeNull();
  });
});

describe('buildFactLines', () => {
  it('期間と会場 → 描き下ろし → グッズ → メニュー → ノベルティ の順に並べる', () => {
    const lines = buildFactLines(
      {
        ...BASE,
        period: { start: '2026-10-16', end: '2026-12-20' },
        venues: ['a', 'b'],
        cities: ['東京', '大阪'],
        redrawnWord: '描き下ろし',
        goodsDetails: [
          { name: '缶バッジ', price: null, sales: 'store_and_online' },
          { name: 'アクスタ', price: null, sales: 'store' },
        ],
        menuCount: 19,
        noveltyNames: ['コースター', 'ステッカー'],
        noveltyRedrawn: true,
      },
      FORMAT
    );

    expect(lines).toEqual([
      '2026年10月16日〜12月20日、東京・大阪の2会場',
      '描き下ろしイラストを使用',
      'GOODS_FEW(店舗/オンライン)',
      'コラボメニュー全19品',
      'ノベルティ：コースター、ステッカー',
    ]);
  });

  it('値の無い行は出さない (「なし」とは書かない)', () => {
    expect(buildFactLines(BASE, FORMAT)).toEqual([]);
  });

  it('期間か会場の片方しか無ければ、ある方だけ', () => {
    expect(buildFactLines({ ...BASE, venues: ['a', 'b'], cities: ['東京'] }, FORMAT)).toEqual(['東京の2会場']);
    expect(buildFactLines({ ...BASE, period: { start: '2026-10-16' } }, FORMAT)).toEqual(['2026年10月16日〜']);
  });

  it('ノベルティは、ノベルティの文脈に描き下ろしが無ければ出さない', () => {
    const lines = buildFactLines({ ...BASE, noveltyNames: ['コースター'], noveltyRedrawn: false }, FORMAT);
    expect(lines).toEqual([]);
  });

  it('グッズの販売方法は詳細から。詳細が無ければ書かない', () => {
    expect(buildFactLines({ ...BASE, goodsDetails: [{ name: 'A', price: null, sales: 'online_only' }] }, FORMAT)).toEqual([
      'GOODS_FEW(オンライン)',
    ]);
    expect(buildFactLines({ ...BASE, goodsNames: ['B', 'C'] }, FORMAT)).toEqual(['GOODS_FEW']);
  });

  it('ノベルティ名は MDX として安全にする', () => {
    const lines = buildFactLines({ ...BASE, noveltyNames: ['{x}'], noveltyRedrawn: true }, FORMAT);
    expect(lines).toEqual(['ノベルティ：&#123;x&#125;']);
  });
});

describe('formatGoodsLine', () => {
  it('10 点以上は十の位で切り捨てて「N0点以上」、10 点未満は数を書かない、0 点は行を出さない', () => {
    expect(formatGoodsLine(43, ['店舗', 'オンライン'], FORMAT)).toBe('GOODS_MANY:40(店舗/オンライン)');
    expect(formatGoodsLine(46, [], FORMAT)).toBe('GOODS_MANY:40');
    expect(formatGoodsLine(10, [], FORMAT)).toBe('GOODS_MANY:10');
    expect(formatGoodsLine(13, [], FORMAT)).toBe('GOODS_MANY:10');
    expect(formatGoodsLine(9, ['店舗'], FORMAT)).toBe('GOODS_FEW(店舗)');
    expect(formatGoodsLine(7, [], FORMAT)).toBe('GOODS_FEW');
    expect(formatGoodsLine(0, ['店舗'], FORMAT)).toBeNull();
  });
});

describe('countGoods', () => {
  it('詳細とグッズ名をそれぞれ表記の揺れを無視して数え、多い方 (確実に言える下限) を返す', () => {
    const details = [
      { name: '缶バッジ（ランダム7種）', price: null, sales: 'store' as const },
      { name: 'Tシャツ', price: null, sales: 'online_only' as const },
    ];
    expect(countGoods(['缶バッジ (ランダム7種)', 'アクリルスタンド'], details)).toBe(2);
    expect(countGoods(['A', 'B', 'C'], details)).toBe(3);
    expect(countGoods(['缶バッジ（ランダム7種）', '缶バッジ (ランダム7種)'], null)).toBe(1);
    expect(countGoods(null, null)).toBe(0);
  });
});

describe('noveltyContextMentionsRedrawn', () => {
  it('ノベルティ名かノベルティのページの本文に語があれば true', () => {
    expect(noveltyContextMentionsRedrawn(['描き下ろしコースター'], [])).toBe(true);
    expect(noveltyContextMentionsRedrawn(['コースター'], ['<p>描き起こしイラストを使用</p>'])).toBe(true);
    expect(noveltyContextMentionsRedrawn(['コースター'], ['<p>オリジナルデザイン</p>'])).toBe(false);
    expect(noveltyContextMentionsRedrawn(null, [])).toBe(false);
  });
});

describe('cleanFeatures', () => {
  it('Markdown の書式 (見出し・強調・リンク・コード) を外して地の文にする', () => {
    expect(
      cleanFeatures(['# 見出し', '**限定**の演出', '[公式](https://example.com)で発表', '`code`', '1.5倍のサイズ', '詳細は https://example.com/a で', '[残った括弧]', 'www.example.com を見る'])
    ).toEqual(['見出し', '限定の演出', '公式で発表', 'code', '1.5倍のサイズ', '詳細は で', '&#91;残った括弧&#93;', 'を見る']);
  });

  it('先頭の箇条書きの記号と改行を除き、MDX として安全にする。空は捨てる', () => {
    expect(cleanFeatures(['- 店内に<等身大>パネル', '・ 1. ではない', '1. 番号付き', '  ', '複数\n行'])).toEqual([
      '店内に&#60;等身大&#62;パネル',
      '1. ではない',
      '番号付き',
      '複数 行',
    ]);
  });
});

describe('cleanFeatures (MDX と重複)', () => {
  it('{ } < > [ ] を文字参照にし、__ は名前の一部として残す。同じ行は 1 つにする', () => {
    expect(cleanFeatures(['<script>{x}</script>', '__init__ という名前', '同じ行', '同じ行'])).toEqual([
      '&#60;script&#62;&#123;x&#125;&#60;/script&#62;',
      '__init__ という名前',
      '同じ行',
    ]);
  });
});

describe('joinArticleParts', () => {
  it('リード文 → 枠 → 本文の順に空行 1 つでつなぎ、空の部分は飛ばす (余分な空行を作らない)', () => {
    expect(joinArticleParts('リード文。', '<ArticlePoints>…</ArticlePoints>', '## メニュー')).toBe(
      'リード文。\n\n<ArticlePoints>…</ArticlePoints>\n\n## メニュー'
    );
    expect(joinArticleParts('リード文。', '', '## メニュー')).toBe('リード文。\n\n## メニュー');
    expect(joinArticleParts('', '  ', '## メニュー')).toBe('## メニュー');
  });
});

describe('renderArticlePoints', () => {
  it('行を箇条書きにして枠で囲む。行が無ければ空 (枠を出さない)', () => {
    expect(renderArticlePoints(['a', 'b'])).toBe('<ArticlePoints>\n\n- a\n- b\n\n</ArticlePoints>');
    expect(renderArticlePoints([])).toBe('');
  });
});
