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
});
