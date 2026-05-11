import {
  MdxFrontmatterSchema,
  type MdxFrontmatter,
} from '@revolution/schemas/mdx-frontmatter';

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

    it('post_id が 10 char ULID 文字列 (01kes3xx1q) で OK (schema 制約は min(1) のみ)', () => {
      const result = MdxFrontmatterSchema.safeParse(validFrontmatterSample1);
      expect(result.success).toBe(true);
    });

    it('post_id が ULID + 年号サフィックス (01kc224njw-2025) でも OK (schema は形式制約なし)', () => {
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
      'tags',
      'work_titles',
      'prefectures',
      'prefecture_slugs',
      'ai_provider',
      'ai_model',
      'venues',
      'venue_slugs',
      // EventFactCard 黄色バッジ点灯のための optional フィールド (Sprint 5)
      'event_start_date',
      'event_end_date',
      'venue',
      'official_url',
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

    it('ISO 8601 ms with negative offset (2026-01-12T12:46:37.016-05:00) は OK', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        date: '2026-01-12T12:46:37.016-05:00',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('year レンジの境界値', () => {
    it.each([2000, 2026, 2050, 2100])('year: %d は OK', (year) => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        year,
      });
      expect(result.success).toBe(true);
    });

    it.each([1999, 2101, 0, -1])('year: %d は失敗 (範囲外)', (year) => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        year,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ogImage の nullability', () => {
    it('ogImage: null で成功 (generate-article-index.ts が null を出力するため)', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        ogImage: null,
      });
      expect(result.success).toBe(true);
    });

    it('ogImage: 文字列で成功', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        ogImage: 'https://example.com/og.png',
      });
      expect(result.success).toBe(true);
    });

    it('ogImage が undefined だと失敗 (nullable は null のみ許容、欠落は不可)', () => {
      const partial: Record<string, unknown> = { ...validFrontmatterSample7 };
      delete partial.ogImage;
      const result = MdxFrontmatterSchema.safeParse(partial);
      expect(result.success).toBe(false);
    });
  });

  describe('tags の OPTIONAL 検証', () => {
    it('tags: 文字列配列で成功', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        tags: ['anime', 'cafe'],
      });
      expect(result.success).toBe(true);
    });

    it('tags: 空配列で成功 (article-index.json 現物が空配列のため)', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        tags: [],
      });
      expect(result.success).toBe(true);
    });

    it('tags: 数値配列だと失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        tags: [1, 2, 3],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('venues / venue_slugs の OPTIONAL 検証 (legacy)', () => {
    it('venues: 文字列配列で成功', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        venues: ['東京', '大阪'],
      });
      expect(result.success).toBe(true);
    });

    it('venue_slugs: 文字列配列で成功', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        venue_slugs: ['tokyo', 'osaka'],
      });
      expect(result.success).toBe(true);
    });

    it('venues の要素に空文字が含まれると失敗 (z.string().min(1))', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        venues: ['東京', ''],
      });
      expect(result.success).toBe(false);
    });

    it('venue_slugs が数値配列だと失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        venue_slugs: [1, 2],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ai_provider の enum 検証', () => {
    it.each(['anthropic', 'gemini', 'openai'] as const)(
      'ai_provider: %s で成功',
      (provider) => {
        const result = MdxFrontmatterSchema.safeParse({
          ...validFrontmatterSample7,
          ai_provider: provider,
        });
        expect(result.success).toBe(true);
      },
    );

    it('ai_provider: 未知のプロバイダ名だと失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        ai_provider: 'cohere',
      });
      expect(result.success).toBe(false);
    });

    it('ai_provider: 大文字小文字違いで失敗 (Anthropic は不可)', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        ai_provider: 'Anthropic',
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

    it('categories の要素に空文字が含まれると失敗 (z.string().min(1))', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        categories: ['valid', ''],
      });
      expect(result.success).toBe(false);
    });

    it('categories: [""] (空文字単体) で失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        categories: [''],
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

  describe('EventFactCard 用 optional フィールドの検証 (Sprint 5)', () => {
    it('event_start_date / event_end_date / venue / official_url が揃った frontmatter で成功', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        event_start_date: '2026-05-14',
        event_end_date: '2026-07-05',
        venue: 'BOX cafe&space マツモトキヨシ池袋Part2店',
        official_url: 'https://example.com/cafe/event',
      });
      expect(result.success).toBe(true);
    });

    it.each([
      '2026-05-14',
      '2025-12-31',
      '2100-01-01',
    ])('event_start_date: %s (YYYY-MM-DD) は OK', (date) => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        event_start_date: date,
      });
      expect(result.success).toBe(true);
    });

    it.each([
      '2026/05/14',          // スラッシュ区切り
      '2026-5-14',           // 月日が 1 桁
      '20260514',            // ハイフンなし
      '2026-05-14T00:00:00', // 時刻付き
      '2026-05-14T00:00:00.000Z', // ISO 8601 ms (date フィールド形式)
      '令和8年5月14日',        // 日本語
    ])('event_start_date: %s は YYYY-MM-DD 違反で失敗', (date) => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        event_start_date: date,
      });
      expect(result.success).toBe(false);
    });

    it('event_end_date も同じ regex 制約 (YYYY-MM-DD のみ許容)', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        event_end_date: '2026/07/05',
      });
      expect(result.success).toBe(false);
    });

    it('venue: 空文字だと失敗 (.min(1))', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        venue: '',
      });
      expect(result.success).toBe(false);
    });

    it('venue: 通常の文字列で成功', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        venue: '池袋',
      });
      expect(result.success).toBe(true);
    });

    it('official_url: 不正な URL で失敗', () => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        official_url: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it.each([
      'https://example.com',
      'http://example.com/path',
      'https://example.com/path?query=1',
    ])('official_url: %s で成功', (url) => {
      const result = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        official_url: url,
      });
      expect(result.success).toBe(true);
    });

    it('start のみ / end のみの片側設定でも parse 成功 (UI 側で unknown フォールバック)', () => {
      const startOnly = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        event_start_date: '2026-05-14',
      });
      expect(startOnly.success).toBe(true);

      const endOnly = MdxFrontmatterSchema.safeParse({
        ...validFrontmatterSample7,
        event_end_date: '2026-07-05',
      });
      expect(endOnly.success).toBe(true);
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
      expect(x.event_start_date).toBeUndefined();
      expect(x.event_end_date).toBeUndefined();
      expect(x.venue).toBeUndefined();
      expect(x.official_url).toBeUndefined();
    });
  });
});
