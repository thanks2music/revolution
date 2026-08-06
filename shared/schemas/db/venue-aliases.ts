import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text } from 'drizzle-orm/pg-core';

import { venues } from './venues';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.venue_aliases
 *
 * 名寄せ補助: 会場の別名 → 正準 `venues.id`。
 * 「表参道ヒルズ B3 / 本館地下 3 階」のような表記ゆれを正規化して
 * `venues.id` へマッピングする。
 *
 * ★ **真実源は YAML**、DB は **seed 先** (2026-08-03 BOSS 確定)。
 *   一次資料: `one-more-time/docs/schema/revolution-naming-yaml.md`
 *   (会場候補 76 件 + 正規化規約)。
 *
 * 設計判断・RLS 方針・index の根拠は `title-aliases.ts` と完全に同一
 * (対になるテーブルのため、判断を分岐させない)。
 * - PK は `alias` 単体、`venue_id` は ON DELETE cascade
 * - ★ `venue_aliases_venue_idx` は必須 (FK 列が未 index になるため)
 * - ★ 非公開 (RLS 有効 + policy なし = anon / authenticated から 0 行)
 */
export const venueAliases = pgTable(
  'venue_aliases',
  {
    alias: text('alias').primaryKey(),
    venueId: bigint('venue_id', { mode: 'number' })
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
  },
  (table) => [
    // ★ PK が alias のため FK 列は未 index。CASCADE の全件スキャンを防ぐ。
    index('venue_aliases_venue_idx').on(table.venueId),
    check('venue_aliases_alias_not_blank', sql`btrim(${table.alias}, E' \t\n\r　') <> ''`),
  ],
);

export type VenueAliasRow = typeof venueAliases.$inferSelect;
export type VenueAliasInsert = typeof venueAliases.$inferInsert;
