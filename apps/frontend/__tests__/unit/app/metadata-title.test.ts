import { describe, expect, it, jest } from '@jest/globals';

/**
 * ページタイトルに**サイト名が二重に出ない**ことを固定する。
 *
 * ## なぜこのテストが必要か (PR #327)
 *
 * `generateBasicMetadata()` は `title.template = '%s | ${siteConfig.name}'` を
 * 定義しているのに、ネストした 6 ページが `title: '… — Revolution'` と
 * **サイト名を直書き**していたため、テンプレートが二重適用され
 * `すべての記事 — Revolution | Revolution` が本番に出ていた。
 *
 * このバグが検出されなかったのは、`app/page.tsx` が root layout と
 * **同一セグメント**で `title.template` の適用対象外だったため。
 * トップだけ正常に見えており、目視では気づけなかった。
 *
 * したがって固定すべき不変条件は 2 つある:
 *
 * 1. root layout がサイト名を付与するテンプレートを持つこと
 * 2. **ネストしたページはサイト名を自分で持たないこと** (二重付与の防止)
 */

const mockGetEventDetail = jest.fn<() => Promise<unknown>>();
const mockGetOccurrenceDetail = jest.fn<() => Promise<unknown>>();

jest.mock('@/lib/event/queries', () => ({
  getEventDetail: () => mockGetEventDetail(),
  listEventParams: () => Promise.resolve([]),
}));
jest.mock('@/lib/occurrence/queries', () => ({
  getOccurrenceDetail: () => mockGetOccurrenceDetail(),
  listOccurrenceParams: () => Promise.resolve([]),
}));

jest.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SITE_NAME: 'テストサイト名',
    NEXT_PUBLIC_SITE_DESCRIPTION: 'テスト説明',
    NEXT_PUBLIC_SITE_URL: 'https://example.com',
    NEXT_PUBLIC_WP_URL: undefined,
  },
}));

describe('metadata の title 合成', () => {
  it('root layout はサイト名を付与するテンプレートを持つ', async () => {
    const { generateBasicMetadata, siteConfig } = await import('@/lib/metadata');
    const title = generateBasicMetadata().title as { default: string; template: string };

    expect(title.template).toBe(`%s | ${siteConfig.name}`);
    expect(title.default).toBe(siteConfig.name);
  });

  it('静的 metadata のページの title はサイト名を含まない (テンプレートが付与するため)', async () => {
    const { siteConfig } = await import('@/lib/metadata');

    const pages = [
      '@/app/articles/page',
      '@/app/mypage/page',
      '@/app/login/page',
      '@/app/onboarding/page',
    ];

    for (const path of pages) {
      const mod = (await import(path)) as { metadata: { title?: unknown } };
      const title = mod.metadata.title;

      expect(typeof title).toBe('string');
      expect(title as string).not.toContain(siteConfig.name);
    }
  });

  /**
   * 動的 metadata の 2 ページも本 PR で直した対象なので同じ不変条件を固定する。
   * 静的 metadata と違い `generateMetadata()` を実行しないと title が得られない
   * ため、データ取得だけを mock して呼び出す。
   *
   * **見つからない場合の早期 return も対象**にする。ここは
   * `generateContentMetadata` を経由せず素の `Metadata` を返す唯一の経路で、
   * 元のバグ (`'企画情報が見つかりません — Revolution'`) が実際に存在した箇所。
   */
  it('動的 metadata (events 系) の title もサイト名を含まない', async () => {
    const { siteConfig } = await import('@/lib/metadata');

    const eventPage = (await import('@/app/events/[id]/page')) as {
      generateMetadata: (p: unknown) => Promise<{ title?: unknown }>;
    };
    const occurrencePage = (await import('@/app/events/[id]/[occurrence_slug]/page')) as {
      generateMetadata: (p: unknown) => Promise<{ title?: unknown }>;
    };

    // (a) データが取れた場合
    mockGetEventDetail.mockResolvedValue({
      event: { id: 'evt_1', name: 'テスト企画', description: null, officialUrl: null },
      titles: [],
      occurrences: [],
      relatedEvents: [],
    });
    mockGetOccurrenceDetail.mockResolvedValue({
      event: { id: 'evt_1', name: 'テスト企画' },
      occurrence: { slug: 'shibuya', venueName: 'テスト会場', startsOn: null, endsOn: null },
      titles: [],
      siblings: [],
    });

    const eventMeta = await eventPage.generateMetadata({
      params: Promise.resolve({ id: 'evt_1' }),
    });
    const occurrenceMeta = await occurrencePage.generateMetadata({
      params: Promise.resolve({ id: 'evt_1', occurrence_slug: 'shibuya' }),
    });

    expect(eventMeta.title as string).not.toContain(siteConfig.name);
    expect(occurrenceMeta.title as string).not.toContain(siteConfig.name);

    // (b) 見つからない場合の早期 return
    mockGetEventDetail.mockResolvedValue(null);
    mockGetOccurrenceDetail.mockResolvedValue(null);

    const eventNotFound = await eventPage.generateMetadata({
      params: Promise.resolve({ id: 'missing' }),
    });
    const occurrenceNotFound = await occurrencePage.generateMetadata({
      params: Promise.resolve({ id: 'missing', occurrence_slug: 'missing' }),
    });

    expect(eventNotFound.title as string).not.toContain(siteConfig.name);
    expect(occurrenceNotFound.title as string).not.toContain(siteConfig.name);
  });
});
