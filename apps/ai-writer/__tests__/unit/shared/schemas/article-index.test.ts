import {
  ArticleIndexItemSchema,
  ArticleIndexSchema,
  type ArticleIndex,
  type ArticleIndexItem,
} from '@revolution/schemas/article-index';

// 過去 PR から抽出した実 frontmatter + filePath + generator が常時出力する空配列
// (両 describe で共有してテスト fixture の重複を避ける)
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
  tags: [],
  filePath:
    'apps/ai-writer/content/collabo-cafe/gundam-iron-blooded-orphans/01kes3xx1q.mdx',
};

describe('ArticleIndexItemSchema', () => {
  describe('正常系', () => {
    it('過去 PR + filePath の fixture で成功', () => {
      const result = ArticleIndexItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it('generator 最小出力 (空配列を持つ) で成功', () => {
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
        tags: [],
        work_titles: [],
        prefectures: [],
        prefecture_slugs: [],
      };
      const result = ArticleIndexItemSchema.safeParse(minimalItem);
      expect(result.success).toBe(true);
    });
  });

  describe('ArticleIndex 専用の required override', () => {
    const requiredArrayFields = ['tags', 'work_titles', 'prefectures', 'prefecture_slugs'] as const;

    it.each(requiredArrayFields)(
      '%s が欠けると失敗 (generator 常時出力のため required override)',
      (fieldName) => {
        const partial: Record<string, unknown> = { ...validItem };
        delete partial[fieldName];
        const result = ArticleIndexItemSchema.safeParse(partial);
        expect(result.success).toBe(false);
      },
    );
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

    it('filePath が空文字だと失敗 (.min(1))', () => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        filePath: '',
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

    it('ogImage: null で成功 (継承元の nullable 制約)', () => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        ogImage: null,
      });
      expect(result.success).toBe(true);
    });

    it('tags: [] (空配列) で成功 (required override だが空配列は許容)', () => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        tags: [],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('配列要素の .min(1) 検証 (required override 後の整合性)', () => {
    const arrayFields = ['tags', 'work_titles', 'prefectures', 'prefecture_slugs'] as const;

    it.each(arrayFields)('%s に空文字要素が含まれると失敗', (fieldName) => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        [fieldName]: ['valid', ''],
      });
      expect(result.success).toBe(false);
    });

    it.each(arrayFields)('%s が [""] (空文字単体) で失敗', (fieldName) => {
      const result = ArticleIndexItemSchema.safeParse({
        ...validItem,
        [fieldName]: [''],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('ArticleIndexSchema', () => {
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

  describe('totalArticles invariant (refine)', () => {
    it('totalArticles と articles.length が一致すると成功', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 2,
        articles: [validItem, validItem],
      });
      expect(result.success).toBe(true);
    });

    it('totalArticles が articles.length より大きいと失敗 (silent bug 防止)', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 99,
        articles: [],
      });
      expect(result.success).toBe(false);
    });

    it('totalArticles が articles.length より小さいと失敗', () => {
      const result = ArticleIndexSchema.safeParse({
        generatedAt: '2026-01-03T08:57:07.710Z',
        totalArticles: 0,
        articles: [validItem, validItem],
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
