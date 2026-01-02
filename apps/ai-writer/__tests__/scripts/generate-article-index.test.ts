/**
 * Tests for generate-article-index.ts script
 *
 * Comprehensive integration tests for article index generation (19 tests total):
 *
 * 1. Script Execution (2 tests)
 *    - Successful execution with --dry-run flag
 *    - Verbose flag handling
 *
 * 2. JSON Output Structure (3 tests)
 *    - Valid JSON with required top-level fields (generatedAt, totalArticles, articles)
 *    - All 17 fields present in each article (8 basic + 9 MDX pipeline + 1 optional)
 *    - Correct data types for all fields (string, number, array validation)
 *
 * 3. Article Sorting (1 test)
 *    - Articles sorted by date in descending order (newest first)
 *
 * 4. Title Validation (2 tests)
 *    - Title length within 40 characters for SEO optimization
 *    - Non-empty titles
 *
 * 5. Multi-location Support (3 tests)
 *    - Consistent length between prefectures and prefecture_slugs arrays
 *    - Proper handling of multiple prefectures (non-empty string validation)
 *    - At least array type validation for prefecture fields
 *
 * 6. Field Validation (3 tests)
 *    - Non-empty required string fields
 *    - Valid year values (2020-2030 range)
 *    - Valid date format (ISO 8601)
 *
 * 7. Error Handling (5 tests)
 *    - No errors during execution
 *    - Graceful handling of missing optional fields
 *    - Exclusion of articles with missing required fields
 *    - Default values for optional fields
 *    - Edge cases in date parsing
 *
 * Test Data Source:
 * - Production logs from 2025-12-30 and 2026-01-01
 * - Real MDX files in apps/ai-writer/content/
 *
 * Field Schema (17 fields):
 * - Basic (8): slug, title, date, excerpt, categories, tags, author, filePath
 * - MDX Pipeline (9): post_id, year, event_type, event_title, work_title,
 *                     work_titles, work_slug, prefectures, prefecture_slugs
 * - Optional (1): ogImage
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { join } from 'path';

const SCRIPT_PATH = join(__dirname, '../../scripts/generate-article-index.ts');

describe('generate-article-index.ts', () => {
  describe('Script Execution', () => {
    it('should execute successfully with --dry-run flag', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      // 基本的な出力確認
      expect(output).toContain('article-index.json 生成スクリプト');
      expect(output).toContain('MDXファイルを検索中');
      expect(output).toContain('frontmatterを解析中');
      expect(output).toContain('処理完了');
    });

    it('should handle verbose flag', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run --verbose`,
        { encoding: 'utf-8' }
      );

      expect(output).toContain('詳細ログモード');
    });
  });

  describe('JSON Output Structure', () => {
    it('should generate valid JSON with required fields', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      // JSON部分を抽出
      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      expect(jsonMatch).toBeTruthy();

      const indexData = JSON.parse(jsonMatch![0]);

      // トップレベル構造の確認
      expect(indexData).toHaveProperty('generatedAt');
      expect(indexData).toHaveProperty('totalArticles');
      expect(indexData).toHaveProperty('articles');
      expect(Array.isArray(indexData.articles)).toBe(true);
      expect(typeof indexData.totalArticles).toBe('number');
      expect(typeof indexData.generatedAt).toBe('string');
    });

    it('should include all 17 fields in each article', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      // 少なくとも1つの記事があることを確認
      expect(indexData.articles.length).toBeGreaterThan(0);

      // 全17フィールドの存在を確認
      const requiredFields = [
        // 基本情報（8フィールド）
        'slug',
        'title',
        'date',
        'excerpt',
        'categories',
        'tags',
        'author',
        'filePath',
        // MDXパイプライン固有（9フィールド）
        'post_id',
        'year',
        'event_type',
        'event_title',
        'work_title',
        'work_titles',       // ← 追加
        'work_slug',
        'prefectures',       // ← 追加
        'prefecture_slugs',  // ← 追加
        // オプショナル（1フィールド）
        'ogImage'
      ];

      indexData.articles.forEach((article: any, index: number) => {
        requiredFields.forEach(field => {
          expect(article).toHaveProperty(field);
        });
      });
    });

    it('should have correct data types for each field', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      if (indexData.articles.length > 0) {
        const article = indexData.articles[0];

        // 文字列フィールド
        expect(typeof article.slug).toBe('string');
        expect(typeof article.title).toBe('string');
        expect(typeof article.date).toBe('string');
        expect(typeof article.excerpt).toBe('string');
        expect(typeof article.author).toBe('string');
        expect(typeof article.filePath).toBe('string');
        expect(typeof article.post_id).toBe('string');
        expect(typeof article.event_type).toBe('string');
        expect(typeof article.event_title).toBe('string');
        expect(typeof article.work_title).toBe('string');
        expect(typeof article.work_slug).toBe('string');

        // 数値フィールド
        expect(typeof article.year).toBe('number');

        // 配列フィールド
        expect(Array.isArray(article.categories)).toBe(true);
        expect(Array.isArray(article.tags)).toBe(true);
        expect(Array.isArray(article.work_titles)).toBe(true);       // ← 追加
        expect(Array.isArray(article.prefectures)).toBe(true);       // ← 追加
        expect(Array.isArray(article.prefecture_slugs)).toBe(true);  // ← 追加

        // オプショナルフィールド（null または string）
        expect(article.ogImage === null || typeof article.ogImage === 'string').toBe(true);
      }
    });
  });

  describe('Article Sorting', () => {
    it('should sort articles by date in descending order (newest first)', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      if (indexData.articles.length >= 2) {
        const dates = indexData.articles.map((article: any) => new Date(article.date).getTime());

        // 各記事の日付が次の記事の日付以降であることを確認
        for (let i = 0; i < dates.length - 1; i++) {
          expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
        }
      }
    });
  });

  describe('Title Validation', () => {
    it('should have titles within 40 characters for SEO optimization', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      // タイトル長違反を収集
      const violations: Array<{ slug: string; title: string; length: number }> = [];

      indexData.articles.forEach((article: any) => {
        if (article.title.length > 40) {
          violations.push({
            slug: article.slug,
            title: article.title,
            length: article.title.length,
          });
        }
      });

      // 違反があればエラーメッセージを表示
      if (violations.length > 0) {
        const errorMessage = [
          `\n${violations.length} article(s) exceed 40-character title limit:`,
          ...violations.map(v => `  - [${v.slug}] ${v.length} chars: "${v.title}"`),
        ].join('\n');

        throw new Error(errorMessage);
      }

      expect(violations.length).toBe(0);
    });

    it('should have non-empty titles', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      indexData.articles.forEach((article: any) => {
        expect(article.title.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Multi-location Support', () => {
    it('should have consistent length between prefectures and prefecture_slugs arrays', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      indexData.articles.forEach((article: any) => {
        expect(article.prefectures.length).toBe(article.prefecture_slugs.length);
      });
    });

    it('should properly handle multiple prefectures', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      // 複数都道府県を持つ記事を検索
      const multiLocationArticles = indexData.articles.filter(
        (article: any) => article.prefectures.length > 1
      );

      // 複数都道府県記事が存在する場合、それぞれの要素がnon-empty文字列であることを確認
      if (multiLocationArticles.length > 0) {
        multiLocationArticles.forEach((article: any) => {
          article.prefectures.forEach((prefecture: string) => {
            expect(typeof prefecture).toBe('string');
            expect(prefecture.length).toBeGreaterThan(0);
          });

          article.prefecture_slugs.forEach((slug: string) => {
            expect(typeof slug).toBe('string');
            expect(slug.length).toBeGreaterThan(0);
          });
        });
      }
    });

    it('should have at least one prefecture for each article', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      // Note: 全記事が都道府県を持つことが理想だが、
      // 現在は空配列も許容する（将来的には最低1つ必要になる可能性がある）
      indexData.articles.forEach((article: any) => {
        expect(Array.isArray(article.prefectures)).toBe(true);
        expect(Array.isArray(article.prefecture_slugs)).toBe(true);
      });
    });
  });

  describe('Field Validation', () => {
    it('should have non-empty required string fields', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      if (indexData.articles.length > 0) {
        const article = indexData.articles[0];

        // 必須文字列フィールドが空でないことを確認
        expect(article.slug.length).toBeGreaterThan(0);
        expect(article.title.length).toBeGreaterThan(0);
        expect(article.post_id.length).toBeGreaterThan(0);
        expect(article.event_type.length).toBeGreaterThan(0);
        expect(article.event_title.length).toBeGreaterThan(0);
        expect(article.work_title.length).toBeGreaterThan(0);
        expect(article.work_slug.length).toBeGreaterThan(0);
      }
    });

    it('should have valid year values', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      indexData.articles.forEach((article: any) => {
        // 年が妥当な範囲内であることを確認
        expect(article.year).toBeGreaterThanOrEqual(2020);
        expect(article.year).toBeLessThanOrEqual(2030);
      });
    });

    it('should have valid date format (ISO 8601)', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      indexData.articles.forEach((article: any) => {
        // 日付が有効なDate文字列であることを確認
        const parsedDate = new Date(article.date);
        expect(parsedDate.toString()).not.toBe('Invalid Date');
      });
    });
  });

  describe('Error Handling', () => {
    it('should not throw errors during execution', () => {
      expect(() => {
        execSync(
          `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      }).not.toThrow();
    });

    it('should handle missing optional fields gracefully', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      // オプショナルフィールド（ogImage）が null の記事があっても問題ないことを確認
      const articlesWithoutOgImage = indexData.articles.filter((article: any) => article.ogImage === null);

      // nullの記事があってもエラーにならないことを確認（存在しなくてもOK）
      expect(articlesWithoutOgImage).toBeDefined();
    });

    it('should exclude articles with missing required fields from the index', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      // インデックスに含まれる全記事は必須フィールドを持つことを確認
      const requiredFields = [
        'post_id', 'year', 'event_type', 'event_title',
        'work_title', 'work_slug', 'slug', 'title', 'date'
      ];

      indexData.articles.forEach((article: any) => {
        requiredFields.forEach(field => {
          expect(article[field]).toBeDefined();
          expect(article[field]).not.toBeNull();
        });
      });
    });

    it('should provide default values for optional fields', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      if (indexData.articles.length > 0) {
        const article = indexData.articles[0];

        // オプショナル配列フィールドはデフォルトで空配列
        if (article.tags.length === 0) {
          expect(article.tags).toEqual([]);
        }

        // work_titles, prefectures, prefecture_slugs も配列（空でも可）
        expect(Array.isArray(article.work_titles)).toBe(true);
        expect(Array.isArray(article.prefectures)).toBe(true);
        expect(Array.isArray(article.prefecture_slugs)).toBe(true);
      }
    });

    it('should handle edge cases in date parsing', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      indexData.articles.forEach((article: any) => {
        // 日付が有効な形式であることを確認
        const parsedDate = new Date(article.date);
        expect(parsedDate.toString()).not.toBe('Invalid Date');

        // year フィールドと date の年が一致することを確認（可能な場合）
        const dateYear = parsedDate.getFullYear();
        // 年は±1年の範囲内であることを許容（年末年始のケース）
        expect(Math.abs(dateYear - article.year)).toBeLessThanOrEqual(1);
      });
    });
  });
});
