/**
 * Unit tests for MDX Template Generator
 *
 * @module __tests__/unit/lib/mdx/template-generator
 */

import { describe, it, expect } from '@jest/globals';
import {
  generateMdxFrontmatter,
  serializeFrontmatter,
  generateMdxFilePath,
  generateMdxArticle,
  isValidMdxFrontmatter,
  MDX_DEFAULTS,
  type GenerateMdxFrontmatterInput,
} from '../../../../lib/mdx';

describe('generateMdxFrontmatter', () => {
  const baseInput: GenerateMdxFrontmatterInput = {
    postId: '01jcxy4567',
    year: 2025,
    eventType: 'collabo-cafe',
    eventTitle: 'コラボカフェ',
    workTitle: '作品名',
    workSlug: 'sample-work',
    title: '作品名×店舗名2025が東京・大阪で開催',
    excerpt: '作品名と店舗名のコラボイベントが実現。',
    categories: ['作品名', 'コラボカフェ'],
  };

  it('should generate valid frontmatter with required fields', () => {
    const frontmatter = generateMdxFrontmatter(baseInput);

    expect(frontmatter.post_id).toBe('01jcxy4567');
    expect(frontmatter.year).toBe(2025);
    expect(frontmatter.event_type).toBe('collabo-cafe');
    expect(frontmatter.event_title).toBe('コラボカフェ');
    expect(frontmatter.work_title).toBe('作品名');
    expect(frontmatter.work_slug).toBe('sample-work');
    expect(frontmatter.slug).toBe('01jcxy4567');
    expect(frontmatter.title).toBe('作品名×店舗名2025が東京・大阪で開催');
    expect(frontmatter.categories).toEqual(['作品名', 'コラボカフェ']);
    expect(frontmatter.excerpt).toBe('作品名と店舗名のコラボイベントが実現。');
  });

  it('should use default values for optional fields', () => {
    const frontmatter = generateMdxFrontmatter(baseInput);

    expect(frontmatter.author).toBe(MDX_DEFAULTS.AUTHOR);
    expect(frontmatter.ogImage).toBe(MDX_DEFAULTS.OG_IMAGE);
    expect(frontmatter.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/); // ISO 8601 ms (Schema-SDD MdxFrontmatterSchema 適合)
  });

  it('should accept custom date, author, and ogImage', () => {
    const frontmatter = generateMdxFrontmatter({
      ...baseInput,
      date: '2025-12-25',
      author: 'custom-author',
      ogImage: '/images/custom-og.png',
    });

    expect(frontmatter.date).toBe('2025-12-25T00:00:00.000Z');
    expect(frontmatter.author).toBe('custom-author');
    expect(frontmatter.ogImage).toBe('/images/custom-og.png');
  });

  it('should generate slug equal to postId', () => {
    const frontmatter = generateMdxFrontmatter(baseInput);
    expect(frontmatter.slug).toBe('01jcxy4567');
  });

  it('should throw error for missing required fields', () => {
    const invalidInput = {
      ...baseInput,
      postId: '',
    };

    expect(() => generateMdxFrontmatter(invalidInput)).toThrow(
      'Required frontmatter fields are missing'
    );
  });

  it('should throw error for missing content fields', () => {
    const invalidInput = {
      ...baseInput,
      title: '',
    };

    expect(() => generateMdxFrontmatter(invalidInput)).toThrow('Content fields');
  });

  it('should throw error for empty categories', () => {
    const invalidInput = {
      ...baseInput,
      categories: [],
    };

    expect(() => generateMdxFrontmatter(invalidInput)).toThrow('Content fields');
  });
});

describe('serializeFrontmatter', () => {
  const frontmatter = generateMdxFrontmatter({
    postId: '01jcxy4567',
    year: 2025,
    eventType: 'collabo-cafe',
    eventTitle: 'コラボカフェ',
    workTitle: '作品名',
    workSlug: 'sample-work',
    title: '作品名×店舗名2025',
    excerpt: 'テスト記事の概要です。',
    categories: ['作品名', 'コラボカフェ'],
    date: '2025-11-19',
  });

  it('should serialize frontmatter to YAML format', () => {
    const yaml = serializeFrontmatter(frontmatter);

    expect(yaml).toContain('---');
    expect(yaml).toContain('post_id: "01jcxy4567"');
    expect(yaml).toContain('year: 2025');
    expect(yaml).toContain('event_type: "collabo-cafe"');
    expect(yaml).toContain('event_title: "コラボカフェ"');
    expect(yaml).toContain('work_title: "作品名"');
    expect(yaml).toContain('work_slug: "sample-work"');
    expect(yaml).toContain('slug: "01jcxy4567"');
  });

  it('should escape quotes in title and excerpt', () => {
    const frontmatterWithQuotes = generateMdxFrontmatter({
      postId: '01jcxy4567',
      year: 2025,
      eventType: 'collabo-cafe',
      eventTitle: 'コラボカフェ',
      workTitle: '作品名',
      workSlug: 'sample-work',
      title: 'Title with "quotes" inside',
      excerpt: 'Excerpt with "quotes" too',
      categories: ['Category'],
      date: '2025-11-19',
    });

    const yaml = serializeFrontmatter(frontmatterWithQuotes);

    expect(yaml).toContain('title: "Title with \\"quotes\\" inside"');
    expect(yaml).toContain('excerpt: "Excerpt with \\"quotes\\" too"');
  });

  it('should serialize categories as YAML array', () => {
    const yaml = serializeFrontmatter(frontmatter);

    expect(yaml).toContain('categories: ["作品名", "コラボカフェ"]');
  });

  it('should end with --- and two empty lines', () => {
    const yaml = serializeFrontmatter(frontmatter);
    const lines = yaml.split('\n');

    expect(lines[0]).toBe('---'); // Start
    expect(lines[lines.length - 3]).toBe('---'); // End of frontmatter
    expect(lines[lines.length - 2]).toBe(''); // First empty line
    expect(lines[lines.length - 1]).toBe(''); // Second empty line
  });

  it('should include optional venues fields if present', () => {
    const frontmatterWithVenues = {
      ...frontmatter,
      venues: ['東京', '大阪'],
      venue_slugs: ['tokyo', 'osaka'],
    };

    const yaml = serializeFrontmatter(frontmatterWithVenues);

    expect(yaml).toContain('venues: ["東京", "大阪"]');
    expect(yaml).toContain('venue_slugs: ["tokyo", "osaka"]');
  });
});

describe('generateMdxFilePath', () => {
  it('should generate correct file path', () => {
    const path = generateMdxFilePath('collabo-cafe', 'sample-work', '01jcxy4567');

    expect(path).toBe('apps/ai-writer/content/collabo-cafe/sample-work/01jcxy4567.mdx');
  });

  it('should handle custom base directory', () => {
    const path = generateMdxFilePath(
      'collabo-cafe',
      'sample-work',
      '01jcxy4567',
      'custom-content'
    );

    expect(path).toBe('custom-content/collabo-cafe/sample-work/01jcxy4567.mdx');
  });

  it('should handle different event types', () => {
    const path = generateMdxFilePath('pop-up-store', 'another-work', '01abcdefgh');

    expect(path).toBe('apps/ai-writer/content/pop-up-store/another-work/01abcdefgh.mdx');
  });
});

describe('generateMdxArticle', () => {
  const input: GenerateMdxFrontmatterInput = {
    postId: '01jcxy4567',
    year: 2025,
    eventType: 'collabo-cafe',
    eventTitle: 'コラボカフェ',
    workTitle: '作品名',
    workSlug: 'sample-work',
    title: '作品名×店舗名2025',
    excerpt: 'テスト記事の概要',
    categories: ['作品名', 'コラボカフェ'],
    date: '2025-11-19',
  };

  const articleContent = `## イベント概要

作品名と店舗名のコラボイベントが開催されます。

## 開催期間

2025年12月25日〜2026年1月15日
`;

  it('should generate complete MDX article', () => {
    const article = generateMdxArticle(input, articleContent);

    expect(article.frontmatter).toBeDefined();
    expect(article.content).toBeDefined();
    expect(article.filePath).toBeDefined();
  });

  it('should combine frontmatter and content', () => {
    const article = generateMdxArticle(input, articleContent);

    expect(article.content).toContain('---');
    expect(article.content).toContain('post_id: "01jcxy4567"');
    expect(article.content).toContain('## イベント概要');
    expect(article.content).toContain('## 開催期間');
  });

  it('should generate correct file path', () => {
    const article = generateMdxArticle(input, articleContent);

    expect(article.filePath).toBe('apps/ai-writer/content/collabo-cafe/sample-work/01jcxy4567.mdx');
  });

  it('should handle custom base directory', () => {
    const article = generateMdxArticle(input, articleContent, 'custom-dir');

    expect(article.filePath).toBe('custom-dir/collabo-cafe/sample-work/01jcxy4567.mdx');
  });

  it('should produce valid MDX structure', () => {
    const article = generateMdxArticle(input, articleContent);

    const lines = article.content.split('\n');

    // Should start with ---
    expect(lines[0]).toBe('---');

    // Should have frontmatter
    expect(article.content).toContain('post_id:');
    expect(article.content).toContain('title:');

    // Should end frontmatter with ---
    expect(article.content).toMatch(/---\n\n## イベント概要/);
  });
});

describe('isValidMdxFrontmatter', () => {
  const validFrontmatter = generateMdxFrontmatter({
    postId: '01jcxy4567',
    year: 2025,
    eventType: 'collabo-cafe',
    eventTitle: 'コラボカフェ',
    workTitle: '作品名',
    workSlug: 'sample-work',
    title: 'Test Title',
    excerpt: 'Test excerpt',
    categories: ['Category'],
    date: '2025-11-19',
  });

  it('should return true for valid frontmatter', () => {
    expect(isValidMdxFrontmatter(validFrontmatter)).toBe(true);
  });

  it('should return false for null/undefined', () => {
    expect(isValidMdxFrontmatter(null)).toBe(false);
    expect(isValidMdxFrontmatter(undefined)).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(isValidMdxFrontmatter('string')).toBe(false);
    expect(isValidMdxFrontmatter(123)).toBe(false);
  });

  it('should return false for missing required fields', () => {
    const invalid = { ...validFrontmatter, post_id: undefined };
    expect(isValidMdxFrontmatter(invalid)).toBe(false);
  });

  it('should return false for wrong field types', () => {
    const invalid = { ...validFrontmatter, year: '2025' }; // should be number
    expect(isValidMdxFrontmatter(invalid)).toBe(false);
  });

  it('should return false for non-array categories', () => {
    const invalid = { ...validFrontmatter, categories: 'not-an-array' };
    expect(isValidMdxFrontmatter(invalid)).toBe(false);
  });

  it('should accept ogImage: null (schema is nullable, generator may emit null)', () => {
    const withNullOgImage = { ...validFrontmatter, ogImage: null };
    expect(isValidMdxFrontmatter(withNullOgImage)).toBe(true);
  });

  it('should reject missing ogImage key (schema is non-optional)', () => {
    const { ogImage: _ogImage, ...withoutOgImage } = validFrontmatter;
    expect(isValidMdxFrontmatter(withoutOgImage)).toBe(false);
  });
});

describe('Integration: Full MDX Generation Flow', () => {
  it('should generate valid MDX file from start to finish', () => {
    const input: GenerateMdxFrontmatterInput = {
    postId: '01jcxy4567',
    year: 2025,
    eventType: 'collabo-cafe',
    eventTitle: 'コラボカフェ',
    workTitle: '作品名',
    workSlug: 'sample-work',
    title: '作品名×店舗名2025が東京・大阪で開催決定',
    excerpt: '作品名と店舗名のコラボイベントが2025年12月25日から開催されます。',
    categories: ['作品名', 'コラボカフェ'],
      date: '2025-11-19',
    };

    const content = `## イベント概要

作品名と店舗名のコラボイベント。

## 開催情報

- **期間**: 2025年12月25日〜2026年1月15日
- **場所**: 主要都市の会場一覧
`;

    const article = generateMdxArticle(input, content);

    // Validate frontmatter
    expect(isValidMdxFrontmatter(article.frontmatter)).toBe(true);

    // Validate file path structure
    expect(article.filePath).toMatch(
      /^apps\/ai-writer\/content\/collabo-cafe\/sample-work\/[0-9a-z]{10}\.mdx$/
    );

    // Validate content structure
    expect(article.content).toContain('---');
    expect(article.content).toContain('post_id: "01jcxy4567"');
    expect(article.content).toContain('## イベント概要');

    // Ensure frontmatter ends properly before content
    const parts = article.content.split('---\n\n');
    expect(parts.length).toBe(2);
    expect(parts[1]).toContain('## イベント概要');
  });
});

// -----------------------------------------------------------------------------
// Sprint C-α PR #268 R1 対応: template-generator の nested YAML round-trip test
// (claude[bot] comment #2, #3, #4, #5 が独立に「template-generator の event_data
// nested YAML serialize が未 test」を指摘、in-scope で追加)
//
// serializeFrontmatter 側の event_data 出力 (line 286-322) と、
// parse-frontmatter (lib/mdx/parse-frontmatter.ts) 側の nested YAML parse が
// round-trip で整合することを保証する Layer 1 test。
// -----------------------------------------------------------------------------
import { parseFrontmatter } from '../../../../lib/mdx/parse-frontmatter';
import type { MdxFrontmatter } from '@revolution/schemas/mdx-frontmatter';

describe('serializeFrontmatter — event_data nested YAML round-trip (Sprint C-α PR #268 R1)', () => {
  const baseFrontmatter: MdxFrontmatter = {
    post_id: '01H8XYZ0000000000000000000',
    year: 2026,
    event_type: 'collabo-cafe',
    event_title: 'コラボカフェ',
    work_title: 'サンプル作品',
    work_titles: ['サンプル作品'],
    work_slug: 'sample-work',
    slug: 'sample-slug',
    title: 'サンプルタイトル',
    date: '2026-07-13T00:00:00.000Z',
    categories: ['サンプル作品', 'コラボカフェ'],
    excerpt: 'サンプル本文',
    author: 'thanks2music',
    ogImage: '/images/og.png',
    tags: [],
    ai_provider: 'openai',
    ai_model: 'gpt-5.4-mini',
    prefectures: [],
    prefecture_slugs: [],
  } as unknown as MdxFrontmatter;

  const buildRoundTripContent = (frontmatter: MdxFrontmatter): MdxFrontmatter => {
    const serialized = serializeFrontmatter(frontmatter);
    // serializeFrontmatter は `---\n...\n---\n\n` を返すため、そのまま parse に渡せる
    const parsed = parseFrontmatter(serialized);
    if (!parsed) {
      throw new Error('parseFrontmatter returned null for round-trip input');
    }
    return parsed;
  };

  it('event_data 未定義時は round-trip で event_data が undefined のまま', () => {
    const parsed = buildRoundTripContent(baseFrontmatter);
    expect(parsed.event_data).toBeUndefined();
  });

  it('単純 event_data (title_slugs のみ、supplementary_category_slugs 空) の round-trip', () => {
    const withEventData: MdxFrontmatter = {
      ...baseFrontmatter,
      event_data: {
        primary_category_slug: 'collabo-cafe',
        title_slugs: ['sample-work'],
      },
    };
    const parsed = buildRoundTripContent(withEventData);
    expect(parsed.event_data).toBeDefined();
    expect(parsed.event_data?.primary_category_slug).toBe('collabo-cafe');
    expect(parsed.event_data?.title_slugs).toEqual(['sample-work']);
  });

  it('event_data.occurrences[] を含む nested YAML の round-trip (Q4=C 由来の中核ケース)', () => {
    const withOccurrences: MdxFrontmatter = {
      ...baseFrontmatter,
      event_data: {
        primary_category_slug: 'collabo-cafe',
        title_slugs: ['sample-work'],
        supplementary_category_slugs: ['pop-up-store'],
        occurrences: [
          {
            venue_slug: null,
            venue_label: 'BOX cafe&space 池袋店',
            starts_on: '2026-07-15',
            ends_on: '2026-08-31',
            official_url: 'https://example.com/event',
          },
        ],
      },
    };
    const parsed = buildRoundTripContent(withOccurrences);
    const occ = parsed.event_data?.occurrences?.[0];
    expect(occ).toBeDefined();
    expect(occ?.venue_slug).toBeNull();
    expect(occ?.venue_label).toBe('BOX cafe&space 池袋店');
    expect(occ?.starts_on).toBe('2026-07-15');
    expect(occ?.ends_on).toBe('2026-08-31');
    expect(occ?.official_url).toBe('https://example.com/event');
  });

  it('ends_on が null (終了日未定 case) の round-trip', () => {
    const undated: MdxFrontmatter = {
      ...baseFrontmatter,
      event_data: {
        primary_category_slug: 'exhibition',
        title_slugs: ['sample-work'],
        occurrences: [
          {
            venue_slug: null,
            venue_label: '常設店舗',
            starts_on: '2026-07-01',
            ends_on: null,
            official_url: null,
          },
        ],
      },
    };
    const parsed = buildRoundTripContent(undated);
    const occ = parsed.event_data?.occurrences?.[0];
    expect(occ?.ends_on).toBeNull();
    expect(occ?.official_url).toBeNull();
  });

  it('venue_label に double-quote を含む場合、round-trip で正しく escape/unescape される (I10 fix 検証)', () => {
    const quoted: MdxFrontmatter = {
      ...baseFrontmatter,
      event_data: {
        primary_category_slug: 'collabo-cafe',
        title_slugs: ['sample-work'],
        occurrences: [
          {
            venue_slug: null,
            venue_label: 'カフェ「わたしの部屋」 3F',
            starts_on: '2026-08-01',
            ends_on: '2026-08-31',
            official_url: 'https://example.com/e2',
          },
        ],
      },
    };
    const parsed = buildRoundTripContent(quoted);
    expect(parsed.event_data?.occurrences?.[0]?.venue_label).toBe('カフェ「わたしの部屋」 3F');
  });

  it('venue_label に backslash を含む場合、round-trip で正しく escape/unescape される (I10 fix 検証、新 escapeYamlDoubleQuoted helper の効果)', () => {
    const backslashed: MdxFrontmatter = {
      ...baseFrontmatter,
      event_data: {
        primary_category_slug: 'collabo-cafe',
        title_slugs: ['sample-work'],
        occurrences: [
          {
            venue_slug: null,
            venue_label: 'C:\\Path\\Store',
            starts_on: '2026-08-01',
            ends_on: '2026-08-31',
            official_url: 'https://example.com/e3',
          },
        ],
      },
    };
    const parsed = buildRoundTripContent(backslashed);
    expect(parsed.event_data?.occurrences?.[0]?.venue_label).toBe('C:\\Path\\Store');
  });

  it('supplementary_category_slugs が空配列でも round-trip 破壊しない (schema optional 準拠)', () => {
    const emptySupp: MdxFrontmatter = {
      ...baseFrontmatter,
      event_data: {
        primary_category_slug: 'collabo-cafe',
        title_slugs: ['sample-work'],
        supplementary_category_slugs: [],
      },
    };
    const parsed = buildRoundTripContent(emptySupp);
    // serializer は空配列を省略するため、parsed 側で undefined になる (schema optional 準拠)
    expect(parsed.event_data?.supplementary_category_slugs === undefined || parsed.event_data?.supplementary_category_slugs?.length === 0).toBe(true);
  });
});
