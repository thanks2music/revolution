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
    it.each(['anthropic', 'google', 'openai'] as const)(
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

    it.each([
      '2026-13-01',  // 月 13 (範囲外)
      '2026-00-15',  // 月 00 (範囲外)
      '2026-02-30',  // 2 月 30 日 (該当月の最大日超過)
      '2026-05-32',  // 日 32 (範囲外)
      '2026-05-00',  // 日 00 (範囲外)
      '2026-13-45',  // 月日両方とも不正
    ])(
      'event_start_date: %s は z.iso.date() の月/日レンジ違反で失敗',
      (date) => {
        const result = MdxFrontmatterSchema.safeParse({
          ...validFrontmatterSample7,
          event_start_date: date,
        });
        expect(result.success).toBe(false);
      },
    );

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
      expect(x.event_data).toBeUndefined();
    });
  });

  // ============================================================================
  // Sprint C-α (MVP §11): EventDataSchema Layer 1 test
  // ============================================================================
  // Codex 2026-07-12 review 中指摘 #3 対応: runtime-shape trust 回避のため、
  // LLM 応答が EventDataSchema に不適合な場合の rejection を直接検証。
  // ============================================================================

  describe('EventDataSchema (MVP §11、Sprint C-α で新設)', () => {
    // 有効な event_data (最頻ケース: 単一作品カフェ)
    const validEventData = {
      primary_category_slug: 'collabo-cafe',
      title_slugs: ['jujutsu-kaisen'],
      supplementary_category_slugs: [],
      occurrences: [
        {
          venue_slug: null,
          venue_label: 'アニメイトカフェ池袋店',
          starts_on: '2026-05-14',
          ends_on: '2026-07-05',
          official_url: 'https://example.com/event',
        },
      ],
    };

    describe('正常系', () => {
      it('最小構成 (primary_category_slug + title_slugs のみ) が parse 成功', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['minimal-work'],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(true);
      });

      it('完全構成 (全 4 プロパティ埋め) が parse 成功', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: validEventData,
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(true);
      });

      it('混在イベント (supplementary_category_slugs 2 件) が parse 成功', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a', 'work-b'],
            supplementary_category_slugs: ['pop-up-store', 'store-collabo'],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(true);
      });
    });

    describe('supplementary_category_slugs max(2) 制約 (Q5=A)', () => {
      it('3 件 supplementary_category_slugs は parse 失敗 (maxItems: 2)', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            supplementary_category_slugs: ['pop-up-store', 'store-collabo', 'exhibition'],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('空配列 supplementary_category_slugs は parse 成功', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            supplementary_category_slugs: [],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(true);
      });
    });

    describe('slug regex 制約 (URL 正準保護)', () => {
      it('大文字 primary_category_slug は parse 失敗 (CATEGORY_SLUG_REGEX)', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'Collabo-Cafe', // 大文字混じり
            title_slugs: ['work-a'],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('先頭ハイフン title_slug は parse 失敗 (TITLE_SLUG_REGEX)', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['-invalid-start'], // 先頭ハイフン
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('連続ハイフン title_slug は parse 失敗', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work--double-hyphen'], // 連続ハイフン
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('日本語 title_slug は parse 失敗 (ASCII lowercase + hyphen only)', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['呪術廻戦'], // 日本語
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });
    });

    describe('occurrences[] validation', () => {
      it('starts_on が YYYY-MM-DD でない (`z.iso.date()` 拒否) と parse 失敗', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            occurrences: [
              {
                venue_slug: null,
                venue_label: 'テスト会場',
                starts_on: '2026-13-01', // 無効月
                ends_on: null,
                official_url: null,
              },
            ],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('starts_on = 2026-02-30 (存在しない日) は parse 失敗', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            occurrences: [
              {
                venue_slug: null,
                venue_label: 'テスト会場',
                starts_on: '2026-02-30',
                ends_on: null,
                official_url: null,
              },
            ],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('official_url が無効 URL だと parse 失敗', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            occurrences: [
              {
                venue_slug: null,
                venue_label: 'テスト会場',
                starts_on: '2026-05-14',
                ends_on: null,
                official_url: 'not-a-url',
              },
            ],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('ends_on = null は parse 成功 (終了日未定 or 単日イベント)', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            occurrences: [
              {
                venue_slug: null,
                venue_label: 'テスト会場',
                starts_on: '2026-05-14',
                ends_on: null,
                official_url: null,
              },
            ],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(true);
      });

      it('全 primary source フィールド埋めた occurrence は parse 成功', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            occurrences: [
              {
                venue_slug: 'valid-venue',
                venue_label: 'BOX cafe&space',
                starts_on: '2026-05-14',
                ends_on: '2026-07-05',
                official_url: 'https://example.com/event',
              },
            ],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(true);
      });
    });

    describe('runtime shape trust 回避 (Codex 中指摘 #3)', () => {
      it('primary_category_slug が missing だと parse 失敗', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            // primary_category_slug 欠落
            title_slugs: ['work-a'],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('title_slugs が missing だと parse 失敗', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            // title_slugs 欠落
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('title_slugs が string (配列でない) だと parse 失敗', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: 'not-an-array', // 型不一致
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });

      it('venue_label が number だと parse 失敗 (LLM 応答異常ケース)', () => {
        const frontmatter = {
          ...validFrontmatterSample7,
          event_data: {
            primary_category_slug: 'collabo-cafe',
            title_slugs: ['work-a'],
            occurrences: [
              {
                venue_slug: null,
                venue_label: 12345 as any, // 型不一致 (LLM が number 返した想定)
                starts_on: '2026-05-14',
                ends_on: null,
                official_url: null,
              },
            ],
          },
        };
        const result = MdxFrontmatterSchema.safeParse(frontmatter);
        expect(result.success).toBe(false);
      });
    });
  });
});
