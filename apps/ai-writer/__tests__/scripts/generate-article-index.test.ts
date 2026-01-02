/**
 * Tests for generate-article-index.ts script
 *
 * Integration tests for article index generation:
 * - Script execution
 * - JSON output validation
 * - Field completeness check
 * - Data structure verification
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

    it('should include all 14 fields in each article', () => {
      const output = execSync(
        `cd ${join(__dirname, '../..')} && npx tsx scripts/generate-article-index.ts --dry-run`,
        { encoding: 'utf-8' }
      );

      const jsonMatch = output.match(/\{[\s\S]*"articles"[\s\S]*\}/);
      const indexData = JSON.parse(jsonMatch![0]);

      // 少なくとも1つの記事があることを確認
      expect(indexData.articles.length).toBeGreaterThan(0);

      // 全14フィールドの存在を確認
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
        // MDXパイプライン固有（6フィールド）
        'post_id',
        'year',
        'event_type',
        'event_title',
        'work_title',
        'work_slug',
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
  });
});
