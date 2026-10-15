import { describe, expect, it } from '@jest/globals';

import {
  buildFactLines,
  cleanFeatures,
  countGoods,
  formatPeriod,
  formatPlace,
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
  goods_line: "コラボグッズ{{count}}点{{#if channels}}（{{channels|join:'・'}}）{{/if}}",
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
      'コラボグッズ2点（店舗・オンライン）',
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
      'コラボグッズ1点（オンライン）',
    ]);
    expect(buildFactLines({ ...BASE, goodsNames: ['B', 'C'] }, FORMAT)).toEqual(['コラボグッズ2点']);
  });

  it('ノベルティ名は MDX として安全にする', () => {
    const lines = buildFactLines({ ...BASE, noveltyNames: ['{x}'], noveltyRedrawn: true }, FORMAT);
    expect(lines).toEqual(['ノベルティ：&#123;x&#125;']);
  });
});

describe('countGoods', () => {
  it('詳細 (オンライン限定を含む) とグッズ名 (トップにしか無い品目を含む) を、表記の揺れを無視して合わせて数える', () => {
    const details = [
      { name: '缶バッジ（ランダム7種）', price: null, sales: 'store' as const },
      { name: 'Tシャツ', price: null, sales: 'online_only' as const },
    ];
    expect(countGoods(['缶バッジ (ランダム7種)', 'アクリルスタンド'], details)).toBe(3);
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
    expect(cleanFeatures(['# 見出し', '**限定**の演出', '[公式](https://example.com)で発表', '`code`', '1.5倍のサイズ'])).toEqual([
      '見出し',
      '限定の演出',
      '公式で発表',
      'code',
      '1.5倍のサイズ',
    ]);
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

describe('renderArticlePoints', () => {
  it('行を箇条書きにして枠で囲む。行が無ければ空 (枠を出さない)', () => {
    expect(renderArticlePoints(['a', 'b'])).toBe('<ArticlePoints>\n\n- a\n- b\n\n</ArticlePoints>');
    expect(renderArticlePoints([])).toBe('');
  });
});
