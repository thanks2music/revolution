/**
 * Layer 1: 公開中の記事の更新で、既存の記事から引き継ぐ値と、更新の PR の名前
 */
import { describe, expect, it } from '@jest/globals';
import {
  findSlugChanges,
  readExistingArticleFields,
  updateBranchName,
  updatePrTitle,
} from '../../../../lib/mdx/article-update';

const article = [
  '---',
  'post_id: "01m4s065g1hchh9d"',
  'year: 2026',
  'event_type: "collabo-cafe"',
  'work_title: "僕のヒーローアカデミア"',
  'work_slug: "my-hero-academia"',
  'slug: "01m4s065g1hchh9d"',
  'title: "ヒロアカ カフェ in 4都市 10月16日よりコラボ開催"',
  'date: "2026-10-12T21:26:06.709Z"',
  'official_url: "https://example.com/"',
  '---',
  '',
  '本文',
].join('\n');

describe('readExistingArticleFields', () => {
  it('引き継ぐ値を読む', () => {
    expect(readExistingArticleFields(article)).toEqual({
      postId: '01m4s065g1hchh9d',
      year: 2026,
      eventType: 'collabo-cafe',
      workSlug: 'my-hero-academia',
      title: 'ヒロアカ カフェ in 4都市 10月16日よりコラボ開催',
      date: '2026-10-12T21:26:06.709Z',
      officialUrl: 'https://example.com/',
    });
  });

  it('official_url が無ければ例外 (作り直しの入力が決まらない)', () => {
    expect(() => readExistingArticleFields(article.replace('official_url: "https://example.com/"\n', ''))).toThrow(
      'official_url がありません',
    );
  });

  it('frontmatter が無ければ例外', () => {
    expect(() => readExistingArticleFields('本文だけ')).toThrow('frontmatter がありません');
  });

  it('year が数でなければ例外 (画像のフォルダに使う)', () => {
    expect(() => readExistingArticleFields(article.replace('year: 2026', 'year: "2026年"'))).toThrow('year が整数ではありません');
  });
});

describe('findSlugChanges', () => {
  const existing = { workSlug: 'my-hero-academia', eventType: 'collabo-cafe' };

  it('同じなら空', () => {
    expect(findSlugChanges(existing, { workSlug: 'my-hero-academia', eventType: 'collabo-cafe' })).toEqual([]);
  });

  it('違う項目を返す', () => {
    expect(findSlugChanges(existing, { workSlug: 'boku-no-hero', eventType: 'popup-store' })).toEqual([
      'work_slug: my-hero-academia → boku-no-hero',
      'event_type: collabo-cafe → popup-store',
    ]);
  });
});

describe('更新の PR の名前', () => {
  it('ブランチは日時 (UTC) 付き', () => {
    expect(updateBranchName('collabo-cafe', '01m4s065g1hchh9d', new Date('2026-10-17T06:30:05.123Z'))).toBe(
      'ai-writer/update-collabo-cafe-01m4s065g1hchh9d-20261017-063005',
    );
  });

  it('PR のタイトル', () => {
    expect(updatePrTitle('collabo-cafe', '01m4s065g1hchh9d')).toBe(
      '♻️ Update article (AI Writer): collabo-cafe/01m4s065g1hchh9d',
    );
  });
});
