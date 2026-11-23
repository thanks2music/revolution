import { describe, expect, it } from '@jest/globals';

import { MAX_LINKS_PER_DETECTION, newLinks } from '../src/detected-links';

const PAGE = 'https://example.com/news/';

describe('newLinks', () => {
  it('前回に無かったリンクだけを、現れた順に返す', () => {
    const before = '<a href="/news/1">1</a>';
    const after = '<a href="/news/3">3</a><a href="/news/2">2</a><a href="/news/1">1</a>';
    expect(newLinks(before, after, PAGE)).toEqual(['https://example.com/news/3', 'https://example.com/news/2']);
  });

  it('相対のリンクは監視対象の URL を基準に直す', () => {
    expect(newLinks('', '<a href="2026/11/01">x</a>', PAGE)).toEqual(['https://example.com/news/2026/11/01']);
  });

  it('計測のパラメータと # 以降の違いだけなら、同じリンクとみなす', () => {
    const before = '<a href="https://example.com/a">a</a>';
    const after = '<a href="https://example.com/a?utm_source=x#top">a</a>';
    expect(newLinks(before, after, PAGE)).toEqual([]);
  });

  it('http(s) 以外のリンクとページ自身は除く', () => {
    const after = '<a href="mailto:a@example.com">m</a><a href="javascript:void(0)">j</a><a href="#top">t</a><a href="tel:000">t</a>';
    expect(newLinks('', after, PAGE)).toEqual([]);
  });

  it('同じリンクが 2 回あっても 1 件', () => {
    expect(newLinks('', '<a href="/x">1</a><a href="/x">2</a>', PAGE)).toEqual(['https://example.com/x']);
  });

  it(`一度に現れても ${MAX_LINKS_PER_DETECTION} 件まで`, () => {
    const after = Array.from({ length: 30 }, (_, i) => `<a href="/n/${i}">${i}</a>`).join('');
    expect(newLinks('', after, PAGE)).toHaveLength(MAX_LINKS_PER_DETECTION);
  });
});
