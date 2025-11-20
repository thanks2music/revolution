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
    workTitle: '呪術廻戦',
    workSlug: 'jujutsu-kaisen',
    title: '呪術廻戦×BOX cafe&space2025が東京・大阪で開催',
    excerpt: '呪術廻戦とBOX cafe&spaceのコラボイベントが実現。',
    categories: ['呪術廻戦', 'コラボカフェ'],
  };

  it('should generate valid frontmatter with required fields', () => {
    const frontmatter = generateMdxFrontmatter(baseInput);

    expect(frontmatter.post_id).toBe('01jcxy4567');
    expect(frontmatter.year).toBe(2025);
    expect(frontmatter.event_type).toBe('collabo-cafe');
    expect(frontmatter.event_title).toBe('コラボカフェ');
    expect(frontmatter.work_title).toBe('呪術廻戦');
    expect(frontmatter.work_slug).toBe('jujutsu-kaisen');
    expect(frontmatter.slug).toBe('01jcxy4567-2025');
    expect(frontmatter.title).toBe('呪術廻戦×BOX cafe&space2025が東京・大阪で開催');
    expect(frontmatter.categories).toEqual(['呪術廻戦', 'コラボカフェ']);
    expect(frontmatter.excerpt).toBe('呪術廻戦とBOX cafe&spaceのコラボイベントが実現。');
  });

  it('should use default values for optional fields', () => {
    const frontmatter = generateMdxFrontmatter(baseInput);

    expect(frontmatter.author).toBe(MDX_DEFAULTS.AUTHOR);
    expect(frontmatter.ogImage).toBe(MDX_DEFAULTS.OG_IMAGE);
    expect(frontmatter.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD
  });

  it('should accept custom date, author, and ogImage', () => {
    const frontmatter = generateMdxFrontmatter({
      ...baseInput,
      date: '2025-12-25',
      author: 'custom-author',
      ogImage: '/images/custom-og.png',
    });

    expect(frontmatter.date).toBe('2025-12-25');
    expect(frontmatter.author).toBe('custom-author');
    expect(frontmatter.ogImage).toBe('/images/custom-og.png');
  });

  it('should generate slug in format {postId}-{year}', () => {
    const frontmatter = generateMdxFrontmatter(baseInput);
    expect(frontmatter.slug).toBe('01jcxy4567-2025');
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
    workTitle: '呪術廻戦',
    workSlug: 'jujutsu-kaisen',
    title: '呪術廻戦×BOX cafe&space2025',
    excerpt: 'テスト記事の概要です。',
    categories: ['呪術廻戦', 'コラボカフェ'],
    date: '2025-11-19',
  });

  it('should serialize frontmatter to YAML format', () => {
    const yaml = serializeFrontmatter(frontmatter);

    expect(yaml).toContain('---');
    expect(yaml).toContain('post_id: "01jcxy4567"');
    expect(yaml).toContain('year: 2025');
    expect(yaml).toContain('event_type: "collabo-cafe"');
    expect(yaml).toContain('event_title: "コラボカフェ"');
    expect(yaml).toContain('work_title: "呪術廻戦"');
    expect(yaml).toContain('work_slug: "jujutsu-kaisen"');
    expect(yaml).toContain('slug: "01jcxy4567-2025"');
  });

  it('should escape quotes in title and excerpt', () => {
    const frontmatterWithQuotes = generateMdxFrontmatter({
      postId: '01jcxy4567',
      year: 2025,
      eventType: 'collabo-cafe',
      eventTitle: 'コラボカフェ',
      workTitle: '呪術廻戦',
      workSlug: 'jujutsu-kaisen',
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

    expect(yaml).toContain('categories: ["呪術廻戦", "コラボカフェ"]');
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
    const path = generateMdxFilePath('collabo-cafe', 'jujutsu-kaisen', '01jcxy4567-2025');

    expect(path).toBe('content/collabo-cafe/jujutsu-kaisen/01jcxy4567-2025.mdx');
  });

  it('should handle custom base directory', () => {
    const path = generateMdxFilePath(
      'collabo-cafe',
      'jujutsu-kaisen',
      '01jcxy4567-2025',
      'custom-content'
    );

    expect(path).toBe('custom-content/collabo-cafe/jujutsu-kaisen/01jcxy4567-2025.mdx');
  });

  it('should handle different event types', () => {
    const path = generateMdxFilePath('pop-up-store', 'spy-family', '01abcdefgh-2024');

    expect(path).toBe('content/pop-up-store/spy-family/01abcdefgh-2024.mdx');
  });
});

describe('generateMdxArticle', () => {
  const input: GenerateMdxFrontmatterInput = {
    postId: '01jcxy4567',
    year: 2025,
    eventType: 'collabo-cafe',
    eventTitle: 'コラボカフェ',
    workTitle: '呪術廻戦',
    workSlug: 'jujutsu-kaisen',
    title: '呪術廻戦×BOX cafe&space2025',
    excerpt: 'テスト記事の概要',
    categories: ['呪術廻戦', 'コラボカフェ'],
    date: '2025-11-19',
  };

  const articleContent = `## イベント概要

呪術廻戦とBOX cafe&spaceのコラボイベントが開催されます。

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

    expect(article.filePath).toBe('content/collabo-cafe/jujutsu-kaisen/01jcxy4567-2025.mdx');
  });

  it('should handle custom base directory', () => {
    const article = generateMdxArticle(input, articleContent, 'custom-dir');

    expect(article.filePath).toBe('custom-dir/collabo-cafe/jujutsu-kaisen/01jcxy4567-2025.mdx');
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
    workTitle: '呪術廻戦',
    workSlug: 'jujutsu-kaisen',
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
});

describe('Integration: Full MDX Generation Flow', () => {
  it('should generate valid MDX file from start to finish', () => {
    const input: GenerateMdxFrontmatterInput = {
      postId: '01jcxy4567',
      year: 2025,
      eventType: 'collabo-cafe',
      eventTitle: 'コラボカフェ',
      workTitle: '呪術廻戦',
      workSlug: 'jujutsu-kaisen',
      title: '呪術廻戦×BOX cafe&space2025が東京・大阪で開催決定',
      excerpt: '呪術廻戦とBOX cafe&spaceのコラボイベントが2025年12月25日から開催されます。',
      categories: ['呪術廻戦', 'コラボカフェ'],
      date: '2025-11-19',
    };

    const content = `## イベント概要

呪術廻戦とBOX cafe&spaceのコラボイベント。

## 開催情報

- **期間**: 2025年12月25日〜2026年1月15日
- **場所**: BOX cafe&space池袋店、大阪日本橋店
`;

    const article = generateMdxArticle(input, content);

    // Validate frontmatter
    expect(isValidMdxFrontmatter(article.frontmatter)).toBe(true);

    // Validate file path structure
    expect(article.filePath).toMatch(
      /^content\/collabo-cafe\/jujutsu-kaisen\/[0-9a-z]{10}-\d{4}\.mdx$/
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
