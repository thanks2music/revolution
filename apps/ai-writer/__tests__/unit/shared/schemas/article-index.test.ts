import {
  ArticleIndexItemSchema,
  ArticleIndexSchema,
  type ArticleIndex,
  type ArticleIndexItem,
} from '../../../../../../shared/schemas/article-index';

describe('ArticleIndexItemSchema', () => {
  // 過去 PR から抽出した実 frontmatter + filePath で構成
  const validItem: ArticleIndexItem = {
    post_id: '01kes3xx1q',
    year: 2026,
    event_type: 'collabo-cafe',
    event_title: 'コラボカフェ',
    work_title: '機動戦士ガンダム 鉄血のオルフェンズ',
    work_titles: ['機動戦士ガンダム 鉄血のオルフェンズ'],
    work_slug: 'gundam-iron-blooded-orphans',
    slug: '01kes3xx1q',
    title: '機動戦士ガンダム 鉄血のオルフェンズ カフェ in 東京',
    date: '2026-01-12T12:46:37.016Z',
    categories: ['機動戦士ガンダム 鉄血のオルフェンズ', 'コラボカフェ'],
    excerpt: 'テスト抜粋',
    author: 'thanks2music',
    ogImage: 'https://images.anime-events.com/.../sample.png',
    ai_provider: 'openai',
    ai_model: 'gpt-4.1-mini',
    prefectures: ['東京都'],
    prefecture_slugs: ['tokyo'],
    filePath:
      'apps/ai-writer/content/collabo-cafe/gundam-iron-blooded-orphans/01kes3xx1q.mdx',
  };

  describe('正常系', () => {
    it('過去 PR + filePath の fixture で成功', () => {
      const result = ArticleIndexItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it('OPTIONAL 最小構成 (Sample 7 + filePath) で成功', () => {
      const minimalItem = {
        post_id: '01kc224njw-2025',
        year: 2025,
        event_type: 'collabo-cafe',
        event_title: 'コラボカフェ',
        work_title: 'ズートピア2',
        work_slug: 'zootopia-2',
        slug: '01kc224njw-2025',
        title: 'ズートピア2 カフェ in 東京',
        date: '2025-12-09T17:21:38.927Z',
        categories: ['ズートピア2', 'コラボカフェ'],
        excerpt: '抜粋',
        author: 'thanks2music',
        ogImage: '/images/og-image-compressed.png',
        filePath: 'apps/ai-writer/content/collabo-cafe/zootopia-2/01kc224njw-2025.mdx',
      };
      const result = ArticleIndexItemSchema.safeParse(minimalItem);
      expect(result.success).toBe(true);
    });
  });

  describe('filePath 必須', () => {
    it('filePath が欠けると失敗', () => {
      const partial: Record<string, unknown> = { ...validItem };
      delete partial.filePath;
      const result = ArticleIndexItemSchema.safeParse(partial);
      expect(result.success).toBe(false);
    });

    it('filePath が数値だと失敗', () => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        filePath: 123,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MdxFrontmatter 継承の検証', () => {
    it('post_id (継承元 MUST) が欠けると失敗', () => {
      const partial: Record<string, unknown> = { ...validItem };
      delete partial.post_id;
      const result = ArticleIndexItemSchema.safeParse(partial);
      expect(result.success).toBe(false);
    });

    it('date が plain YYYY-MM-DD だと失敗 (継承元の制約)', () => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        date: '2025-11-20',
      });
      expect(result.success).toBe(false);
    });

    it('OPTIONAL (work_titles) が欠けても成功', () => {
      const partial: Record<string, unknown> = { ...validItem };
      delete partial.work_titles;
      const result = ArticleIndexItemSchema.safeParse(partial);
      expect(result.success).toBe(true);
    });

    it('ogImage: null で成功 (継承元の nullable 制約)', () => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        ogImage: null,
      });
      expect(result.success).toBe(true);
    });

    it('tags: [] (空配列) で成功 (継承元の OPTIONAL)', () => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        tags: [],
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('ArticleIndexSchema', () => {
  const validItem: ArticleIndexItem = {
    post_id: '01kes3xx1q',
    year: 2026,
    event_type: 'collabo-cafe',
    event_title: 'コラボカフェ',
    work_title: 'テスト作品',
    work_slug: 'test-work',
    slug: '01kes3xx1q',
    title: 'テストタイトル',
    date: '2026-01-12T12:46:37.016Z',
    categories: ['テスト'],
    excerpt: '抜粋',
    author: 'thanks2music',
    ogImage: '/images/og.png',
    filePath: 'apps/ai-writer/content/collabo-cafe/test-work/01kes3xx1q.mdx',
  };

  describe('正常系', () => {
    it('1 件の article を持つ index で成功', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 1,
        articles: [validItem],
      });
      expect(result.success).toBe(true);
    });

    it('空 articles 配列で成功', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 0,
        articles: [],
      });
      expect(result.success).toBe(true);
    });

    it('複数 article で成功', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 3,
        articles: [validItem, validItem, validItem],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('wrapper 構造の必須性', () => {
    it('generatedAt が欠けると失敗', () => {
      const result = ArticleIndexSchema.safeParse({
        totalArticles: 0,
        articles: [],
      });
      expect(result.success).toBe(false);
    });

    it('totalArticles が欠けると失敗', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        articles: [],
      });
      expect(result.success).toBe(false);
    });

    it('articles が欠けると失敗', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 0,
      });
      expect(result.success).toBe(false);
    });

    it('totalArticles が負だと失敗', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: -1,
        articles: [],
      });
      expect(result.success).toBe(false);
    });

    it('totalArticles が小数だと失敗', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 1.5,
        articles: [],
      });
      expect(result.success).toBe(false);
    });

    it('generatedAt が plain YYYY-MM-DD だと失敗 (ISO 8601 ms 強制)', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03',
        totalArticles: 0,
        articles: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('articles 内の不正データ', () => {
    it('articles 配列内に不正な item があると失敗', () => {
      const invalidItem = {
        ...validItem,
        date: '2025-11-20', // plain YYYY-MM-DD は失敗形式
      };
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 1,
        articles: [invalidItem],
      });
      expect(result.success).toBe(false);
    });

    it('articles が配列でないと失敗', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 0,
        articles: validItem,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('z.infer で型が正しく派生する', () => {
    it('ArticleIndex 型として代入できる', () => {
      const x: ArticleIndex = {
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 1,
        articles: [validItem],
      };
      expect(x.totalArticles).toBe(1);
      expect(x.articles[0].post_id).toBe('01kes3xx1q');
    });

    it('ArticleIndexItem は MdxFrontmatter のフィールド + filePath を持つ', () => {
      const item: ArticleIndexItem = validItem;
      expect(item.filePath).toBeDefined();
      expect(item.post_id).toBeDefined();
    });
  });
});
