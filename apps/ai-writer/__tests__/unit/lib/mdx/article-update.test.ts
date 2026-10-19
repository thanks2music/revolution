/**
 * Layer 1: 公開中の記事の更新で、既存の記事から引き継ぐ値と、更新の PR の名前
 */
import { describe, expect, it } from '@jest/globals';
import {
  describeEventKeys,
  findSlugChanges,
  inheritEventKeys,
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
      eventKeys: {},
    });
  });

  it('title_slugs が配列でなければ読まない (古い形式・手で書いた値)', () => {
    const scalar = article.replace('---\n\n本文', 'event_data:\n  primary_category_slug: "collabo-cafe"\n  title_slugs: "my-hero-academia"\n---\n\n本文');
    expect(readExistingArticleFields(scalar).eventKeys).toEqual({ primary_category_slug: 'collabo-cafe' });
  });

  it('event_data の企画を決める項目を読む (occurrences は読まない)', () => {
    const withEventData = article.replace(
      '---\n\n本文',
      [
        'event_data:',
        '  primary_category_slug: "collabo-cafe"',
        '  title_slugs: ["my-hero-academia"]',
        '  event_name: "僕のヒーローアカデミアカフェ"',
        '  event_slug: "my-hero-academia-cafe-we-are-hero-holics"',
        '  occurrences:',
        '    - venue_slug: null',
        '      venue_label: "原宿"',
        '      starts_on: "2026-10-16"',
        '      ends_on: "2026-12-20"',
        '      official_url: "https://example.com/"',
        '---',
        '',
        '本文',
      ].join('\n'),
    );
    expect(readExistingArticleFields(withEventData).eventKeys).toEqual({
      event_slug: 'my-hero-academia-cafe-we-are-hero-holics',
      event_name: '僕のヒーローアカデミアカフェ',
      title_slugs: ['my-hero-academia'],
      primary_category_slug: 'collabo-cafe',
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

  it('文字列の値が文字列でなければ例外', () => {
    expect(() => readExistingArticleFields(article.replace('date: "2026-10-12T21:26:06.709Z"', 'date: 20261012'))).toThrow(
      'date が文字列ではありません',
    );
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

describe('inheritEventKeys', () => {
  const regenerated = {
    primary_category_slug: 'collabo-cafe',
    title_slugs: ['boku-no-hero-academia'],
    event_name: '僕のヒーローアカデミアカフェ',
    event_slug: 'boku-no-hero-academia-cafe-we-are-hero-holics',
    occurrences: [{ venue_slug: null, venue_label: '原宿', starts_on: '2026-10-16', ends_on: '2026-12-20', official_url: null }],
  } as never;
  const existingKeys = {
    event_slug: 'my-hero-academia-cafe-we-are-hero-holics',
    event_name: '僕のヒーローアカデミアカフェ',
    title_slugs: ['my-hero-academia'],
    primary_category_slug: 'collabo-cafe',
  };

  it('既存の記事の値に戻し、違った項目を返す。occurrences は作り直した値のまま (ヒロアカ、2026-10-19)', () => {
    const result = inheritEventKeys(regenerated, existingKeys);
    expect(result.eventData).toMatchObject({
      title_slugs: ['my-hero-academia'],
      event_slug: 'my-hero-academia-cafe-we-are-hero-holics',
      occurrences: [{ venue_label: '原宿' }],
    });
    expect(result.kept).toEqual(['event_slug', 'event_name', 'title_slugs', 'primary_category_slug']);
    expect(result.changes).toEqual([
      'event_slug: boku-no-hero-academia-cafe-we-are-hero-holics → my-hero-academia-cafe-we-are-hero-holics (既存の記事の値に戻した)',
      'title_slugs: boku-no-hero-academia → my-hero-academia (既存の記事の値に戻した)',
    ]);
    expect(result.rejected).toBeNull();
  });

  it('既存の記事に項目が無ければ、作り直した値のまま (kept は空)', () => {
    expect(inheritEventKeys(regenerated, {})).toEqual({ eventData: regenerated, kept: [], changes: [], rejected: null });
  });

  it('作り直した event_data が無ければ undefined のまま、その理由を返す', () => {
    const result = inheritEventKeys(undefined, existingKeys);
    expect(result).toMatchObject({ eventData: undefined, kept: [], changes: [] });
    expect(result.rejected).toContain('作り直した event_data が無い');
  });

  it('形式に合わない項目だけ引き継がず、ほかの項目は引き継ぐ', () => {
    const result = inheritEventKeys(regenerated, { ...existingKeys, event_slug: 'Bad Slug!' });
    expect(result.eventData).toMatchObject({
      event_slug: 'boku-no-hero-academia-cafe-we-are-hero-holics',
      title_slugs: ['my-hero-academia'],
    });
    expect(result.kept).toEqual(['event_name', 'title_slugs', 'primary_category_slug']);
    expect(result.rejected).toBe('既存の記事の値が今の形式に合わない項目は引き継がなかった (event_slug)');
  });

  it('occurrences は作り直した値そのもの (同じオブジェクト) を返す', () => {
    const result = inheritEventKeys(regenerated, existingKeys);
    expect((result.eventData as { occurrences: unknown }).occurrences).toBe((regenerated as { occurrences: unknown }).occurrences);
  });

  it('戻した主カテゴリが補助のカテゴリにも入っていれば、補助から外す', () => {
    const popup = { ...(regenerated as object), primary_category_slug: 'pop-up-store', supplementary_category_slugs: ['collabo-cafe'] } as never;
    const result = inheritEventKeys(popup, { primary_category_slug: 'collabo-cafe' });
    expect(result.eventData).toMatchObject({ primary_category_slug: 'collabo-cafe', supplementary_category_slugs: [] });
  });

  it('作り直した値が空の配列なら「(なし)」と表示する', () => {
    const empty = { ...(regenerated as object), title_slugs: [] } as never;
    expect(inheritEventKeys(empty, { title_slugs: ['my-hero-academia'] }).changes).toEqual([
      'title_slugs: (なし) → my-hero-academia (既存の記事の値に戻した)',
    ]);
  });
});

describe('describeEventKeys', () => {
  it('引き継いで、戻した項目があれば並べる', () => {
    expect(
      describeEventKeys({ kept: ['event_slug', 'title_slugs'], changes: ['title_slugs: a → b (既存の記事の値に戻した)'], rejected: null }),
    ).toBe('- 引き継いだ項目: event_slug / title_slugs\n- title_slugs: a → b (既存の記事の値に戻した)');
  });

  it('引き継いで、作り直した値も同じなら、そう書く', () => {
    expect(describeEventKeys({ kept: ['event_slug'], changes: [], rejected: null })).toBe(
      '- 引き継いだ項目: event_slug\n- 作り直した値も既存の記事と同じだった',
    );
  });

  it('既存の記事に項目が無ければ、作り直した値を使ったと書く', () => {
    expect(describeEventKeys({ kept: [], changes: [], rejected: null })).toBe(
      '- 既存の記事にこれらの項目が無いため、作り直した値を使っている',
    );
  });

  it('引き継げなかった項目があれば、引き継いだ項目と並べて理由を書く', () => {
    expect(
      describeEventKeys({ kept: ['title_slugs'], changes: [], rejected: '既存の記事の値が今の形式に合わない項目は引き継がなかった (event_slug)' }),
    ).toBe(
      '- 引き継いだ項目: title_slugs\n- 作り直した値も既存の記事と同じだった\n- ⚠️ 既存の記事の値が今の形式に合わない項目は引き継がなかった (event_slug)。その項目は作り直した値を使っている (差分で確かめる)',
    );
  });

  it('作り直した event_data が無ければ、その理由だけを書く', () => {
    expect(describeEventKeys({ kept: [], changes: [], rejected: '作り直した event_data が無い (会場の数が 0 になり、減少として止まる)' })).toBe(
      '- ⚠️ 作り直した event_data が無い (会場の数が 0 になり、減少として止まる)。その項目は作り直した値を使っている (差分で確かめる)',
    );
  });
});
