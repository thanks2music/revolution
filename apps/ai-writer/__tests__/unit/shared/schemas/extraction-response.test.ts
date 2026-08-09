/**
 * Layer 1 tests for extraction-response schema.
 *
 * Focus: cross-schema compatibility between `StrictEventDataSchema` (inline in extraction-response)
 * and the downstream `EventDataSchema` (mdx-frontmatter). The strict variant is meant to be
 * strictly more restrictive; its output must always pass the downstream schema.
 */

import { ExtractionResponseSchema } from '@revolution/schemas/extraction-response';
import { EventDataSchema } from '@revolution/schemas/mdx-frontmatter';

function buildValidExtractionResponse() {
  return {
    works: [{ title: 'テスト作品', title_en: null, is_primary: true }],
    store: { name: 'テスト店舗', multiple_locations: null },
    メディアタイプ: 'anime',
    原作タイプ: 'manga_based',
    原作者有無: true,
    原作者名: ['テスト先生'],
    スタジオ名: null,
    監督名: null,
    シリーズ名: null,
    開催期間: {
      開始: { 年: '2026年', 日付: '5月1日' },
      終了: { 年: '2026年', 日付: '6月30日', 未定: false },
    },
    公式サイトURL: 'https://example.com',
    略称: null,
    キャラクター名: null,
    テーマ名: null,
    開催回数: '第2弾',
    ノベルティ名: null,
    ノベルティ種類数: null,
    メニュー種類数: null,
    グッズ名: null,
    メニュー詳細リスト: null,
    メニューテーマ説明: null,
    具体的なメニュー名リスト: null,
    店舗の住所: null,
    開催都道府県: null,
    コピーライト: null,
    TwitterURL: null,
    event_data: {
      event_name: 'テストイベント',
      event_slug: 'test-event',
      primary_category_slug: 'collabo-cafe',
      title_slugs: ['test-work'],
      supplementary_category_slugs: [],
      occurrences: [
        {
          venue_slug: null,
          venue_label: 'テスト店舗',
          starts_on: '2026-05-01',
          ends_on: '2026-06-30',
          official_url: 'https://example.com/event',
        },
      ],
    },
    _reasoning: {
      works: 'test',
      work_vs_store: 'test',
      store: 'test',
      開催期間: 'test',
      メディアタイプ: 'test',
      原作タイプ: 'test',
      原作者名: 'test',
      スタジオ名: null,
      監督名: null,
      シリーズ名: null,
      開催都道府県: 'test',
      メニュー詳細リスト: null,
      メニューテーマ説明: null,
      具体的なメニュー名リスト: null,
      event_data_reason: 'test',
    },
  };
}

describe('extraction-response schema — cross-schema compatibility', () => {
  it('a valid ExtractionResponse.event_data passes downstream EventDataSchema.safeParse (strict ⊆ mdx-frontmatter contract)', () => {
    // StrictEventDataSchema and EventDataSchema are maintained in separate files; the mutual-compat
    // claim in extraction-response.ts's doc comment ("EventDataSchema.safeParse(strict output)
    // succeeds") must be guarded by a test so silent drift between them is caught at CI time.
    const payload = buildValidExtractionResponse();
    const parsedStrict = ExtractionResponseSchema.safeParse(payload);
    expect(parsedStrict.success).toBe(true);
    if (!parsedStrict.success) return;

    const downstream = EventDataSchema.safeParse(parsedStrict.data.event_data);
    expect(downstream.success).toBe(true);
    if (downstream.success) {
      // Round-trip preserves the shape (no silent field loss between the two schemas).
      expect(downstream.data.primary_category_slug).toBe('collabo-cafe');
      expect(downstream.data.title_slugs).toEqual(['test-work']);
      expect(downstream.data.occurrences).toHaveLength(1);
    }
  });

  it('empty supplementary_category_slugs is preserved through both schemas (strict requires the field, downstream accepts empty array)', () => {
    const payload = buildValidExtractionResponse();
    const parsedStrict = ExtractionResponseSchema.safeParse(payload);
    expect(parsedStrict.success).toBe(true);
    if (!parsedStrict.success) return;

    const downstream = EventDataSchema.safeParse(parsedStrict.data.event_data);
    expect(downstream.success).toBe(true);
    if (downstream.success) {
      expect(downstream.data.supplementary_category_slugs).toEqual([]);
    }
  });

  // ★ 多開催 (2026-08-09)。実データでは 5 会場のイベントが常態で、
  //   さらに同一会場が前期/後期に分かれる例もある (8 会場 × 2 期 = 16 開催)。
  //   strict 変種と downstream の両方が N 件を保持できることを固定する。
  it('preserves N occurrences through both schemas (5 venues)', () => {
    const payload = buildValidExtractionResponse();
    payload.event_data.occurrences = [
      {
        venue_slug: null,
        venue_label: 'OH MY CAFE 表参道ヒルズ',
        starts_on: '2026-07-03',
        ends_on: '2026-09-13',
        official_url: null,
      },
      {
        venue_slug: null,
        venue_label: 'BOX cafe&space ルミネエスト新宿2号店',
        starts_on: '2026-07-03',
        ends_on: '2026-09-13',
        official_url: null,
      },
      {
        venue_slug: null,
        venue_label: 'BOX cafe&space グローバルゲート名古屋2号店',
        starts_on: '2026-07-10',
        ends_on: '2026-08-31',
        official_url: null,
      },
      {
        venue_slug: null,
        venue_label: 'BOX cafe&space ＫＩＴＴＥ OSAKA 2号店',
        starts_on: '2026-07-03',
        ends_on: '2026-09-13',
        official_url: null,
      },
      {
        venue_slug: null,
        venue_label: 'BALLER:S イオンモール新利府店',
        starts_on: '2026-07-17',
        ends_on: '2026-08-24',
        official_url: null,
      },
    ];

    const parsedStrict = ExtractionResponseSchema.safeParse(payload);
    expect(parsedStrict.success).toBe(true);
    if (!parsedStrict.success) return;

    const downstream = EventDataSchema.safeParse(parsedStrict.data.event_data);
    expect(downstream.success).toBe(true);
    if (downstream.success) {
      expect(downstream.data.occurrences).toHaveLength(5);
      // 会場ごとに期間が違うことが保たれる (多会場の 8 割超でこれが起きる)
      expect(downstream.data.occurrences?.[2]?.ends_on).toBe('2026-08-31');
      expect(downstream.data.occurrences?.[4]?.starts_on).toBe('2026-07-17');
    }
  });

  it('preserves the same venue appearing twice (前期/後期)', () => {
    const payload = buildValidExtractionResponse();
    payload.event_data.occurrences = [
      {
        venue_slug: null,
        venue_label: 'BOX cafe&space グランドスケープ池袋店',
        starts_on: '2025-04-04',
        ends_on: '2025-06-02',
        official_url: null,
      },
      {
        venue_slug: null,
        venue_label: 'BOX cafe&space グランドスケープ池袋店',
        starts_on: '2025-06-05',
        ends_on: '2025-07-27',
        official_url: null,
      },
    ];

    const downstream = EventDataSchema.safeParse(payload.event_data);
    expect(downstream.success).toBe(true);
    if (downstream.success) {
      expect(downstream.data.occurrences).toHaveLength(2);
      expect(downstream.data.occurrences?.[0]?.venue_label).toBe(
        downstream.data.occurrences?.[1]?.venue_label
      );
    }
  });

  // ★ 日程未発表 (A-1-c パターン 1/2)。捏造させないための契約。
  it('accepts a null starts_on (日程未発表)', () => {
    const payload = buildValidExtractionResponse();
    payload.event_data.occurrences = [
      {
        venue_slug: null,
        venue_label: '△△ホール',
        starts_on: null,
        ends_on: null,
        official_url: null,
      },
    ];

    const parsedStrict = ExtractionResponseSchema.safeParse(payload);
    expect(parsedStrict.success).toBe(true);

    const downstream = EventDataSchema.safeParse(payload.event_data);
    expect(downstream.success).toBe(true);
    if (downstream.success) {
      expect(downstream.data.occurrences?.[0]?.starts_on).toBeNull();
    }
  });

  // ★ event_slug は events upsert の自然キー。slug regex 違反を弾く。
  it('rejects an event_slug that violates the slug regex', () => {
    const payload = buildValidExtractionResponse();
    payload.event_data.event_slug = 'Invalid Slug';

    expect(ExtractionResponseSchema.safeParse(payload).success).toBe(false);
  });
});
