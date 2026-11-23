/**
 * `generateMdxFromRSS()`: the article's kind (`event_type`) comes from the extraction's
 * `primary_category_slug`, and RSS candidates of scheduled runs stop when the page is outside the
 * writing scope (`lib/scheduled/writing-scope.ts`).
 *
 * The extraction gives no start date, so a run that goes past the writing scope stops right after it
 * as an unannounced event (no sub-page / Vision / AI calls are mocked).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/utils/html-extractor', () => ({
  extractArticleHtml: jest.fn(),
  extractContentHtml: jest.fn(),
  extractOgImageUrl: jest.fn(),
  extractPageLinks: jest.fn(),
}));
jest.mock('@/lib/github/create-mdx-pr', () => ({ createMdxPr: jest.fn() }));
jest.mock('@/lib/github/update-mdx-pr', () => ({ createUpdateMdxPr: jest.fn() }));
jest.mock('@/lib/firestore/event-deduplication', () => ({
  checkEventDuplication: jest.fn(),
  registerNewEvent: jest.fn(),
  updateEventStatus: jest.fn(),
}));
jest.mock('@/lib/services/r2-storage.service', () => ({ getR2StorageService: jest.fn() }));
// The writing scope lives in the private templates; the tests use a made-up one
jest.mock('@/lib/scheduled/writing-scope', () => ({
  ...jest.requireActual<object>('@/lib/scheduled/writing-scope'),
  loadWritingScope: () => [{ category: 'exhibition', operator: 'ltr' }],
}));
// The venue check compares venues with the page; one extraction that passes is enough here
jest.mock('@/lib/utils/venue-completeness-gate', () => ({
  ...jest.requireActual<object>('@/lib/utils/venue-completeness-gate'),
  runVenueCompletenessGate: jest.fn(
    async ({
      runAttempt,
    }: {
      runAttempt: (attempt: number, previous: undefined, max: number) => Promise<unknown>;
    }) => ({
      extraction: await runAttempt(1, undefined, 1),
      verdict: { status: 'unmeasured', reason: 'test', truthStatus: 'unsupported' },
    })
  ),
}));

const mockShouldGenerateArticle = jest.fn();
jest.mock('@/lib/services/article-selection.service', () => ({
  ArticleSelectionService: jest.fn().mockImplementation(() => ({
    shouldGenerateArticle: mockShouldGenerateArticle,
  })),
}));

const mockExtractFromOfficialSite = jest.fn();
jest.mock('@/lib/services/extraction.service', () => ({
  ExtractionService: jest.fn().mockImplementation(() => ({
    extractFromOfficialSite: mockExtractFromOfficialSite,
  })),
  isMissingWorkTitle: jest.requireActual<typeof import('@/lib/services/extraction.service')>(
    '@/lib/services/extraction.service'
  ).isMissingWorkTitle,
}));

const { extractArticleHtml, extractContentHtml, extractOgImageUrl } =
  require('@/lib/utils/html-extractor') as {
    extractArticleHtml: jest.Mock;
    extractContentHtml: jest.Mock;
    extractOgImageUrl: jest.Mock;
  };
const { ArticleGenerationMdxService } =
  require('@/lib/services/article-generation-mdx.service') as typeof import('@/lib/services/article-generation-mdx.service');

/** A page with the LTR site structure (`.place` blocks) */
const LTR_HTML = `<div class="info-container">
  <div class="place"><h2>TOKYO</h2><p class="place_text_01">BOX cafe&amp;space 池袋店</p></div>
</div>`;
const OTHER_HTML = '<div><p>会場: 横浜のショッピングモール</p></div>';

const rssItem = {
  title: 'Event title',
  link: 'https://news.example.com/article/1',
  content: '<p>body</p>',
  pubDate: new Date('2026-11-15T00:00:00Z').toISOString(),
};
const extracted = { workTitle: 'Work', storeName: 'Store', eventTypeName: 'グッズ販売' };

function givenOfficialSite(raw: string, primaryCategorySlug: unknown, startsOn?: string) {
  extractArticleHtml.mockResolvedValueOnce('<html></html>' as never);
  mockShouldGenerateArticle.mockResolvedValueOnce({
    should_generate: true,
    primary_official_url: 'https://official.example.com/',
    official_urls: ['https://official.example.com/'],
    reason: 'ok',
  } as never);
  extractContentHtml.mockResolvedValueOnce({ compacted: '<p>official</p>', raw } as never);
  extractOgImageUrl.mockReturnValue(null);
  mockExtractFromOfficialSite.mockResolvedValueOnce({
    作品名: 'Work',
    店舗名: 'Store',
    event_data: { primary_category_slug: primaryCategorySlug },
    // a start date lets the run past the unannounced check
    ...(startsOn
      ? {
          開催期間: {
            開始: { 年: '2026年', 日付: startsOn },
            終了: { 年: null, 日付: null, 未定: true },
          },
        }
      : {}),
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const run = (applyWritingScope?: boolean) =>
  new ArticleGenerationMdxService().generateMdxFromRSS({
    rssItem,
    dryRun: true,
    extracted,
    applyWritingScope,
  });

describe('the article kind', () => {
  it('comes from primary_category_slug, not from the RSS event type name', async () => {
    givenOfficialSite(LTR_HTML, 'pop-up-store');
    const result = await run();
    expect(result.writingScope).toMatchObject({ category: 'pop-up-store' });
  });

  it('fails as a step error (retried by scheduled runs) when the extraction gives no valid kind', async () => {
    givenOfficialSite(LTR_HTML, 'goods-sales');
    const result = await run(true);
    expect(result).toMatchObject({
      success: false,
      skipped: true,
      skipKind: 'step-error',
      skipReason: '種別を判定できない (抽出結果の値: "goods-sales")',
    });
    expect(result.writingScope).toBeUndefined();
  });
});

describe('the writing scope', () => {
  it('stops an RSS candidate whose kind is not in the scope', async () => {
    givenOfficialSite(LTR_HTML, 'chain-store');
    const result = await run(true);
    expect(result).toMatchObject({
      skipped: true,
      skipKind: 'out-of-scope',
      skipReason: '書く対象の外 (種別 chain-store / 運営 LTR)',
      writingScope: { category: 'chain-store', operator: 'ltr', inScope: false },
    });
  });

  it('stops an RSS candidate of an in-scope kind whose site has no known structure', async () => {
    givenOfficialSite(OTHER_HTML, 'exhibition', '12月1日');
    const result = await run(true);
    expect(result).toMatchObject({
      skipKind: 'out-of-scope',
      writingScope: { category: 'exhibition', operator: 'unknown', inScope: false },
    });
  });

  it('waits as unannounced when an in-scope kind with an unknown operator has no start date yet (a first report has no venue list)', async () => {
    givenOfficialSite(OTHER_HTML, 'exhibition');
    const result = await run(true);
    expect(result.skipKind).toBe('unannounced-event');
    expect(result.writingScope).toMatchObject({ operator: 'unknown', inScope: false });
  });

  it('gives no verdict for an archived page (the operator cannot be read from it)', async () => {
    mockExtractFromOfficialSite.mockResolvedValueOnce({
      作品名: 'Work',
      店舗名: 'Store',
      event_data: { primary_category_slug: 'collabo-cafe' },
    } as never);
    const result = await new ArticleGenerationMdxService().generateMdxFromRSS({
      rssItem,
      dryRun: true,
      extracted,
      sourceOverride: {
        officialUrl: 'https://gone.example.com/event/',
        contentHtml: { compacted: '<p>archive</p>', raw: '<p>archive</p>' },
        ogImage: null,
        categoryImages: {
          menu: [],
          novelty: [],
          goods: [],
          sources: {},
          all: [],
          mentionsRedrawnIllustration: false,
          redrawnPages: [],
          pages: [],
          venueNoveltyImages: [],
          imageAlts: {},
        },
        reason: 'unreachable',
        unlinkScope: 'host',
      },
    });
    expect(result.skipKind).toBe('unannounced-event');
    expect(result.writingScope).toBeUndefined();
  });

  it('lets an in-scope pair go on', async () => {
    givenOfficialSite(LTR_HTML, 'exhibition');
    const result = await run(true);
    expect(result.skipKind).not.toBe('out-of-scope');
    expect(result.writingScope).toEqual({
      category: 'exhibition',
      operator: 'ltr',
      inScope: true,
    });
  });

  it('only reports the verdict when the run is not limited (registered URLs, the CLI)', async () => {
    givenOfficialSite(OTHER_HTML, 'chain-store');
    const result = await run(false);
    expect(result.skipKind).not.toBe('out-of-scope');
    expect(result.writingScope).toMatchObject({ inScope: false });
  });
});
