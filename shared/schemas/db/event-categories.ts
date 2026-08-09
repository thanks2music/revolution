import { bigint, index, pgTable, primaryKey } from 'drizzle-orm/pg-core';

import { categories } from './categories';
import { events } from './events';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.event_categories
 *
 * events ↔ categories の M:N 関連テーブル (混在イベント用の補助タグ)。
 * 1 企画 (event) が複数の categories (イベントタイプ) を持つ場合を表現する。
 *
 * 「主分類 + 補助タグ」設計 (event-review-data-model.md §6):
 * - `events.primary_category_id` = URL 正準セグメントを決める主分類 (1 つ、必須)
 * - `event_categories` = 補助タグ (複数、任意)
 * - 例: ポップアップストア (primary) + コラボドリンク (補助タグ) の同時開催
 * - **primary_category_id と event_categories は重複可** (同じ category が両方に
 *   出てくる = 主分類でありかつタグにも入れたい、というケースは正常)
 *
 * 設計判断 (B-1、旧 MVP §11):
 * - composite PK `(event_id, category_id)` で重複を防止。
 * - `event_categories_category_idx` は **category_id 単独検索** (「コラボドリンク
 *   のある全 event」横断クエリ) のための btree secondary index。composite PK の
 *   leftmost prefix は event_id のため、category_id 単独検索は PK インデックスで
 *   ヒットしない (PostgreSQL btree の仕様、SSoT :167 明示)。
 * - onDelete cascade (events 側): 企画が削除されたら関連レコードも自動削除。
 * - onDelete restrict (categories 側): category を削除しようとしたら
 *   event_categories に参照があれば拒否 = master 一貫性維持 (event_titles と同方針)。
 *
 * RLS は同じ migration で `enable row level security` + SELECT 公開 policy 1
 * 本を付与 (anon/authenticated 読み取り公開、書き込み service role のみ)。
 */
export const eventCategories = pgTable(
  'event_categories',
  {
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.categoryId] }),
    // category_id 単独検索用の btree secondary index。
    index('event_categories_category_idx').on(table.categoryId),
  ],
);

export type EventCategoryRow = typeof eventCategories.$inferSelect;
export type EventCategoryInsert = typeof eventCategories.$inferInsert;
