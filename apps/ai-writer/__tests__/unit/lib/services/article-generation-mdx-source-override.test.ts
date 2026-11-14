/**
 * `sourceOverride` / `eventYear` of `generateMdxFromRSS()`: when the official site is gone, the given
 * page replaces article selection and the official-site fetch, and the event year reaches extraction.
 *
 * Detail extraction is made to fail so the run stops right after the inputs are decided.
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
}));

const { extractArticleHtml, extractContentHtml } = require('@/lib/utils/html-extractor') as {
  extractArticleHtml: jest.Mock;
  extractContentHtml: jest.Mock;
};
const { ArticleGenerationMdxService } = require('@/lib/services/article-generation-mdx.service') as {
  ArticleGenerationMdxService: new () => {
    generateMdxFromRSS: (req: unknown) => Promise<{ success: boolean; skipped?: boolean; skipReason?: string }>;
  };
};

const rssItem = {
  title: 'Event title',
  link: 'https://archive.example.com/events/sample-event/',
  content: '<p>archive body</p>',
  pubDate: new Date('2026-11-15T00:00:00Z').toISOString(),
};

const sourceOverride = {
  officialUrl: 'https://gone.example.com/event/',
  contentHtml: { compacted: '<p>compacted archive</p>', raw: '<div><p>raw archive</p></div>' },
  ogImage: 'https://archive.example.com/wp-content/uploads/kv.jpg',
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
  linkOfficialSite: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockExtractFromOfficialSite.mockRejectedValue(new Error('stop here') as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('sourceOverride', () => {
  it('uses the given page instead of selecting and fetching the official site', async () => {
    const service = new ArticleGenerationMdxService();
    const result = await service.generateMdxFromRSS({
      rssItem,
      dryRun: true,
      eventYear: 2019,
      sourceOverride,
      extracted: { workTitle: 'Work', storeName: 'Store', eventTypeName: 'collabo' },
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('stop here');
    expect(mockShouldGenerateArticle).not.toHaveBeenCalled();
    expect(extractArticleHtml).not.toHaveBeenCalled();
    expect(extractContentHtml).not.toHaveBeenCalled();
    expect(mockExtractFromOfficialSite).toHaveBeenCalledWith(
      expect.objectContaining({
        primary_official_url: 'https://gone.example.com/event/',
        page_content: '<p>compacted archive</p>',
        reference_year: 2019,
      }),
    );
  });
});

describe('eventYear without sourceOverride', () => {
  it('selects and fetches the official site as before, and gives the event year to extraction', async () => {
    extractArticleHtml.mockResolvedValueOnce('<html></html>' as never);
    mockShouldGenerateArticle.mockResolvedValueOnce({
      should_generate: true,
      primary_official_url: 'https://official.example.com/',
      official_urls: [],
      reason: 'ok',
    } as never);
    extractContentHtml.mockResolvedValueOnce({ compacted: '<p>official</p>', raw: '<p>official</p>' } as never);

    const service = new ArticleGenerationMdxService();
    await service.generateMdxFromRSS({
      rssItem: { ...rssItem, link: 'https://official.example.com/' },
      dryRun: true,
      eventYear: 2021,
      extracted: { workTitle: 'Work', storeName: 'Store', eventTypeName: 'collabo' },
    });

    expect(extractContentHtml).toHaveBeenCalledWith('https://official.example.com/');
    expect(mockExtractFromOfficialSite).toHaveBeenCalledWith(
      expect.objectContaining({ page_content: '<p>official</p>', reference_year: 2021 }),
    );
  });
});
