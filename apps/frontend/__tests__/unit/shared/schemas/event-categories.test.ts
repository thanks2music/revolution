import { describe, expect, it } from '@jest/globals';

import { EventCategoryInsertSchema, EventInsertSchema } from '@revolution/schemas/event';

/**
 * Sprint B 固有シナリオ: 「主分類 + 補助タグ」設計の Layer 1 検証
 * (event-review-data-model.md §6)
 *
 * - `events.primary_category_id` (主分類、必須 1 つ、URL 正準決定)
 * - `event_categories` (M:N 補助タグ、複数任意)
 * - **主分類と補助タグは重複可** (例: primary=collabo-cafe + 補助タグにも
 *   collabo-cafe を明示 = 主分類を強調したい、というケースは正常)
 *
 * DB 側の composite PK 重複拒否 (`event_categories_event_id_category_id_pk`) と
 * onDelete cascade/restrict は Layer 2 で保証、ここでは Zod insert 型が各レコード
 * を個別に受理することを確認。
 */
describe('EventCategoryInsertSchema', () => {
  it('accepts single category association', () => {
    expect(() =>
      EventCategoryInsertSchema.parse({ eventId: 1, categoryId: 1 }),
    ).not.toThrow();
  });

  it('accepts multiple category associations (混在イベント: ポップアップ + コラボドリンク等)', () => {
    // 例: primary=collabo-cafe (id=1) + 補助タグ pop-up-store (id=2) の混在
    const mixed = [
      { eventId: 1, categoryId: 1 }, // collabo-cafe
      { eventId: 1, categoryId: 2 }, // pop-up-store
    ];
    for (const row of mixed) {
      expect(() => EventCategoryInsertSchema.parse(row)).not.toThrow();
    }
  });

  it('accepts event_categories row with same category_id as primary (主分類 + 補助タグ 重複可)', () => {
    // 主分類 = collabo-cafe (primary_category_id=1)
    // 補助タグにも同 category を明示的に含めるケース (主分類を強調する意図)
    expect(() =>
      EventInsertSchema.parse({
        slug: 'collab-cafe-with-tag',
        name: 'x',
        primaryCategoryId: 1,
      }),
    ).not.toThrow();
    expect(() =>
      EventCategoryInsertSchema.parse({ eventId: 1, categoryId: 1 }),
    ).not.toThrow();
  });

  it('rejects missing event_id', () => {
    expect(() =>
      EventCategoryInsertSchema.parse({ categoryId: 1 }),
    ).toThrow();
  });

  it('rejects missing category_id', () => {
    expect(() =>
      EventCategoryInsertSchema.parse({ eventId: 1 }),
    ).toThrow();
  });
});
