import { describe, expect, it } from '@jest/globals';

import type { ArticleIndexItem } from '@/lib/mdx/article-types';
import {
  collectArticleCategorySlugs,
  collectTitleCategoryParams,
  resolveArticleTitleLinks,
  resolveCategoryLabel,
  selectTitleArticles,
} from '@/lib/title/article-links';

/**
 * `lib/title/article-links.ts` (Layer 1) — 記事 ⇄ 作品の紐付け (案 X)。
 *
 * ## 何を固定したいか
 *
 * **AI 出力ゆれ入りの記事が、取り込み済みの正準経由で作品に紐づく**こと。
 * fixture は実データ由来: 記事 `01m02zcdrevxhcj4` (名探偵コナン) は
 * `title_slugs: ["meitantei-conan"]` (ゆれ) を持ち、titles マスタの正準は
 * `detective-conan`。`event_slug` 経由でのみ正しく紐づく (2026-08-20 実測)。
 */

function article(overrides: {
  slug: string;
  date: string;
  eventSlug?: string;
  titleSlugs?: string[];
  categorySlug?: string;
  eventTitle?: string;
  noEventData?: boolean;
}): ArticleIndexItem {
  return {
    slug: overrides.slug,
    title: `記事 ${overrides.slug}`,
    date: overrides.date,
    excerpt: '',
    categories: [],
    tags: [],
    author: 'thanks2music',
    filePath: `apps/ai-writer/content/x/${overrides.slug}.mdx`,
    event_type: 'collabo-cafe',
    work_slug: null,
    event_title: overrides.eventTitle,
    event_data: overrides.noEventData
      ? undefined
      : {
          primary_category_slug: overrides.categorySlug ?? 'collabo-cafe',
          title_slugs: overrides.titleSlugs ?? [],
          event_slug: overrides.eventSlug,
          occurrences: [],
        },
  } as ArticleIndexItem;
}

describe('selectTitleArticles', () => {
  it('links a drifted article through the ingested event_slug (案 X の核心)', async () => {
    // 実データ再現: title_slugs は「meitantei-conan」(ゆれ) だが、
    // 取り込みが event_titles に正準 detective-conan を張っている
    // = detective-conan の企画の events.slug に記事の event_slug が含まれる。
    const conan = article({
      slug: '01m02zcdrevxhcj4',
      date: '2026-08-10',
      eventSlug: 'detective-conan-cafe-2026',
      titleSlugs: ['meitantei-conan'],
    });

    const picked = selectTitleArticles(
      [conan],
      new Set(['detective-conan-cafe-2026']),
      'detective-conan',
    );
    expect(picked).toEqual([conan]);
  });

  it('falls back to exact canonical slug match for un-ingested articles', () => {
    // 企画が DB に無い (eventSlugs に含まれない) 記事は正準 slug の直接一致のみ。
    const exact = article({
      slug: 'a1',
      date: '2026-08-01',
      eventSlug: 'not-ingested-yet',
      titleSlugs: ['jujutsu-kaisen'],
    });
    const drifted = article({
      slug: 'a2',
      date: '2026-08-02',
      eventSlug: 'also-not-ingested',
      titleSlugs: ['meitantei-conan'],
    });

    expect(selectTitleArticles([exact, drifted], new Set(), 'jujutsu-kaisen')).toEqual([exact]);
    // ゆれた記事は取り込まれるまで出ない (verified ゲートと同じ思想)。
    expect(selectTitleArticles([exact, drifted], new Set(), 'detective-conan')).toEqual([]);
  });

  it('sorts newest first and ignores articles without event_data', () => {
    const older = article({ slug: 'old', date: '2026-07-01', titleSlugs: ['jujutsu-kaisen'] });
    const newer = article({ slug: 'new', date: '2026-08-01', titleSlugs: ['jujutsu-kaisen'] });
    const legacy = article({ slug: 'legacy', date: '2026-09-01', noEventData: true });

    expect(selectTitleArticles([older, legacy, newer], new Set(), 'jujutsu-kaisen')).toEqual([
      newer,
      older,
    ]);
  });

  it('does not duplicate an article matching both the event_slug and the title_slugs', () => {
    const both = article({
      slug: 'both',
      date: '2026-08-01',
      eventSlug: 'jujutsu-kaisen-cafe',
      titleSlugs: ['jujutsu-kaisen'],
    });

    expect(
      selectTitleArticles([both], new Set(['jujutsu-kaisen-cafe']), 'jujutsu-kaisen'),
    ).toHaveLength(1);
  });
});

describe('collectArticleCategorySlugs', () => {
  it('collects unique category slugs in first-seen order', () => {
    const articles = [
      article({ slug: 'a', date: '2026-08-01', categorySlug: 'collabo-cafe' }),
      article({ slug: 'b', date: '2026-08-02', categorySlug: 'popup-store' }),
      article({ slug: 'c', date: '2026-08-03', categorySlug: 'collabo-cafe' }),
      article({ slug: 'd', date: '2026-08-04', noEventData: true }),
    ];
    expect(collectArticleCategorySlugs(articles)).toEqual(['collabo-cafe', 'popup-store']);
  });
});

describe('resolveCategoryLabel', () => {
  it('resolves the Japanese label from event_title, falling back to the slug', () => {
    const articles = [
      article({ slug: 'a', date: '2026-08-01', categorySlug: 'collabo-cafe', eventTitle: 'コラボカフェ' }),
    ];
    expect(resolveCategoryLabel(articles, 'collabo-cafe')).toBe('コラボカフェ');
    expect(resolveCategoryLabel(articles, 'popup-store')).toBe('popup-store');
  });
});

describe('collectTitleCategoryParams', () => {
  it('builds (title, category) pairs only for master titles with matching articles', () => {
    const articles = [
      // event_slug 経由 (ゆれ入り記事): detective-conan にだけ紐づく
      article({
        slug: 'conan',
        date: '2026-08-10',
        eventSlug: 'detective-conan-cafe-2026',
        titleSlugs: ['meitantei-conan'],
        categorySlug: 'collabo-cafe',
      }),
      // 直接一致: jujutsu-kaisen
      article({
        slug: 'jjk',
        date: '2026-08-01',
        titleSlugs: ['jujutsu-kaisen'],
        categorySlug: 'collabo-cafe',
      }),
    ];
    const pairs = [
      {
        titleSlug: 'detective-conan',
        titleName: '名探偵コナン',
        eventSlug: 'detective-conan-cafe-2026',
      },
    ];

    const params = collectTitleCategoryParams(
      articles,
      ['detective-conan', 'jujutsu-kaisen', 'pochacco'],
      pairs,
    );

    expect(params).toEqual(
      expect.arrayContaining([
        { slug: 'detective-conan', category: 'collabo-cafe' },
        { slug: 'jujutsu-kaisen', category: 'collabo-cafe' },
      ]),
    );
    // 記事 0 件の作品 (pochacco) と、マスタに無い slug (meitantei-conan) の組は作らない。
    expect(params).toHaveLength(2);
  });
});

describe('resolveArticleTitleLinks', () => {
  const TITLES = [
    { slug: 'detective-conan', name: '名探偵コナン' },
    { slug: 'jujutsu-kaisen', name: '呪術廻戦' },
  ];
  const PAIRS = [
    {
      titleSlug: 'detective-conan',
      titleName: '名探偵コナン',
      eventSlug: 'detective-conan-cafe-2026',
    },
  ];

  it('resolves a drifted article to the canonical title via event_slug', () => {
    // 記事の title_slugs は「meitantei-conan」(ゆれ) だが、リンク先は正準
    // detective-conan でなければならない (ゆれの slug はページが無く 404 になる)。
    const conan = article({
      slug: '01m02zcdrevxhcj4',
      date: '2026-08-10',
      eventSlug: 'detective-conan-cafe-2026',
      titleSlugs: ['meitantei-conan'],
    });

    expect(resolveArticleTitleLinks(conan, TITLES, PAIRS)).toEqual([
      { slug: 'detective-conan', name: '名探偵コナン' },
    ]);
  });

  it('falls back to exact canonical slug match for un-ingested articles', () => {
    const jjk = article({ slug: 'jjk', date: '2026-08-01', titleSlugs: ['jujutsu-kaisen'] });

    expect(resolveArticleTitleLinks(jjk, TITLES, PAIRS)).toEqual([
      { slug: 'jujutsu-kaisen', name: '呪術廻戦' },
    ]);
  });

  it('drops slugs that are not in the titles master (no links to 404)', () => {
    // ゆれた slug しか無く、企画も未取り込みならリンクを出さない。
    const drifted = article({
      slug: 'drifted',
      date: '2026-08-01',
      eventSlug: 'not-ingested',
      titleSlugs: ['meitantei-conan'],
    });

    expect(resolveArticleTitleLinks(drifted, TITLES, PAIRS)).toEqual([]);
  });

  it('does not duplicate a title matched by both paths', () => {
    const both = article({
      slug: 'both',
      date: '2026-08-01',
      eventSlug: 'detective-conan-cafe-2026',
      titleSlugs: ['detective-conan'],
    });

    expect(resolveArticleTitleLinks(both, TITLES, PAIRS)).toHaveLength(1);
  });

  it('returns [] for an article without event_data', () => {
    const legacy = article({ slug: 'legacy', date: '2026-08-01', noEventData: true });
    expect(resolveArticleTitleLinks(legacy, TITLES, PAIRS)).toEqual([]);
  });

  it('returns [] when the master lookup is empty (credential-less build)', () => {
    // 資格情報が無いビルドでは titles / pairs が空になり、チップは
    // リンク無しのテキストへ静かに戻る (graceful degradation)。
    const conan = article({
      slug: 'conan',
      date: '2026-08-01',
      eventSlug: 'detective-conan-cafe-2026',
      titleSlugs: ['detective-conan'],
    });

    expect(resolveArticleTitleLinks(conan, [], [])).toEqual([]);
  });
});
