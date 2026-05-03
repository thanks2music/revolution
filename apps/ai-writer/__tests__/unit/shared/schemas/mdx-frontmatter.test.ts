import {
  MdxFrontmatterSchema,
  type MdxFrontmatter,
} from '../../../../../../shared/schemas/mdx-frontmatter';

describe('MdxFrontmatterSchema', () => {
  // 過去 PR から抽出した実 frontmatter（Sample 1: gundam-iron-blooded-orphans）
  const validFrontmatterSample1: MdxFrontmatter = {
    post_id: '01kes3xx1q',
    year: 2026,
    event_type: 'collabo-cafe',
    event_title: 'コラボカフェ',
    work_title: '機動戦士ガンダム 鉄血のオルフェンズ',
    work_titles: ['機動戦士ガンダム 鉄血のオルフェンズ'],
    work_slug: 'gundam-iron-blooded-orphans',
    slug: '01kes3xx1q',
    title: '機動戦士ガンダム 鉄血のオルフェンズ カフェ in 東京 12月18日よりコラボ開催',
    date: '2026-01-12T12:46:37.016Z',
    categories: ['機動戦士ガンダム 鉄血のオルフェンズ', 'コラボカフェ'],
    excerpt: 'テスト抜粋',
    author: 'thanks2music',
    ogImage:
      'https://images.anime-events.com/collabo-cafe/2026/01kes3xx1q/f66c792d-420d-46f7-88ac-d50e37e16936.png',
    ai_provider: 'openai',
    ai_model: 'gpt-4.1-mini',
    prefectures: ['東京都'],
    prefecture_slugs: ['tokyo'],
  };

  // 過去 PR から抽出した実 frontmatter（Sample 7: zootopia-2、optional フィールド最小構成）
  const validFrontmatterSample7: MdxFrontmatter = {
    post_id: '01kc224njw-2025',
    year: 2025,
    event_type: 'collabo-cafe',
    event_title: 'コラボカフェ',
    work_title: 'ズートピア2',
    work_slug: 'zootopia-2',
    slug: '01kc224njw-2025',
    title: 'ズートピア2 カフェ in 東京/大阪/名古屋/福岡 12月19日よりコラボ開催',
    date: '2025-12-09T17:21:38.927Z',
    categories: ['ズートピア2', 'コラボカフェ', 'イベント情報'],
    excerpt: '『ズートピア2』の世界観を体験できるスペシャルコラボカフェ',
    author: 'thanks2music',
    ogImage: '/images/og-image-compressed.png',
  };

  describe('正常系', () => {
    it('Sample 1 (全 OPTIONAL 付き) が parse 成功', () => {
      const result = MdxFrontmatterSchema.safeParse(validFrontmatterSample1);
      expect(result.success).toBe(true);
    });

    it('Sample 7 (OPTIONAL 最小構成) が parse 成功', () => {
      const result = MdxFrontmatterSchema.safeParse(validFrontmatterSample7);
      expect(result.success).toBe(true);
    });

    it('post_id が ULID 10 char (01kes3xx1q) の形式で OK', () => {
      const result = MdxFrontmatterSchema.safeParse(validFrontmatterSample1);
      expect(result.success).toBe(true);
    });

    it('post_id が ULID + 年号サフィックス (01kc224njw-2025) の形式で OK', () => {
      const result = MdxFrontmatterSchema.safeParse(validFrontmatterSample7);
      expect(result.success).toBe(true);
    });
  });

  describe('MUST フィールド欠落で失敗', () => {
    const mustFields = [
      'post_id',
      'year',
      'event_type',
      'event_title',
      'work_title',
      'work_slug',
      'slug',
      'title',
      'date',
      'categories',
      'excerpt',
      'author',
      'ogImage',
    ] as const;

    it.each(mustFields)('%s が欠けると失敗', (fieldName) => {
      const partial: Record<string, unknown> = { ...validFrontmatterSample1 };
      delete partial[fieldName];
      const result = MdxFrontmatterSchema.safeParse(partial);
      expect(result.success).toBe(false);
    });
  });

  describe('OPTIONAL フィールド省略可能', () => {
    const optionalFields = [
      'work_titles',
      'prefectures',
      'prefecture_slugs',
      'ai_provider',
      'ai_model',
    ] as const;

    it.each(optionalFields)('%s が欠けても成功', (fieldName) => {
      const partial: Record<string, unknown> = { ...validFrontmatterSample1 };
      delete partial[fieldName];
      const result = MdxFrontmatterSchema.safeParse(partial);
      expect(result.success).toBe(true);
    });
  });

  describe('date 形式の検証', () => {
    it('ISO 8601 ms with Z (2026-01-12T12:46:37.016Z) は OK', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        date: '2026-01-12T12:46:37.016Z',
      });
      expect(result.success).toBe(true);
    });

    it('ISO 8601 ms with offset (2026-01-12T12:46:37.016+09:00) は OK', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        date: '2026-01-12T12:46:37.016+09:00',
      });
      expect(result.success).toBe(true);
    });

    it('plain YYYY-MM-DD (2025-11-20) は失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        date: '2025-11-20',
      });
      expect(result.success).toBe(false);
    });

    it('precision なし (2025-12-30T05:10:23Z) は失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        date: '2025-12-30T05:10:23Z',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('型不一致', () => {
    it('categories が文字列単体だと失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        categories: 'コラボカフェ',
      });
      expect(result.success).toBe(false);
    });

    it('categories が数値配列だと失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        categories: [1, 2, 3],
      });
      expect(result.success).toBe(false);
    });

    it('year が文字列だと失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        year: '2025',
      });
      expect(result.success).toBe(false);
    });

    it('year が小数だと失敗 (z.number().int())', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        year: 2025.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('境界値', () => {
    it('categories が空配列でも成功 (min 制約なし)', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        categories: [],
      });
      expect(result.success).toBe(true);
    });

    it('post_id が空文字だと失敗 (min(1))', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        post_id: '',
      });
      expect(result.success).toBe(false);
    });

    it('slug が空文字だと失敗 (min(1))', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        slug: '',
      });
      expect(result.success).toBe(false);
    });

    it('title が空文字だと失敗 (min(1))', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        title: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('z.infer で型が正しく派生する', () => {
    it('MdxFrontmatter 型として代入できる', () => {
      // コンパイル時のチェック: validFrontmatterSample1 は MdxFrontmatter 型として代入可能
      const x: MdxFrontmatter = validFrontmatterSample1;
      expect(x.post_id).toBe('01kes3xx1q');
      expect(x.year).toBe(2026);
    });

    it('OPTIONAL フィールドは undefined 許容', () => {
      const x: MdxFrontmatter = validFrontmatterSample7;
      expect(x.work_titles).toBeUndefined();
      expect(x.prefectures).toBeUndefined();
      expect(x.ai_provider).toBeUndefined();
    });
  });
});
