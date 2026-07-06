import { bigint, index, pgTable, primaryKey } from 'drizzle-orm/pg-core';

import { events } from './events';
import { titles } from './titles';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.event_titles
 *
 * events ↔ titles の M:N 関連テーブル (コラボイベント対応)。1 企画 (event) が
 * 複数の作品 (title) を含む場合 (例: 呪術廻戦 × 鬼滅の刃 のコラボカフェ) を
 * 表現する。逆方向 (1 作品が複数 event に関連) も同構造で自然表現される。
 *
 * 設計判断 (MVP「Around the World」§11 データモデル基盤先行統合、Sprint B):
 * - composite PK `(event_id, title_id)` で重複を防止 (同じ event に同じ title
 *   を 2 回関連付ける組み合わせは無意味)。
 * - `event_titles_title_idx` は **title_id 単独検索** (「呪術廻戦が関連する
 *   全 event」横断クエリ) のための btree secondary index。composite PK の
 *   leftmost prefix は event_id のため、title_id 単独検索は PK インデックスで
 *   ヒットしない (PostgreSQL btree の仕様、SSoT :147 明示)。
 * - onDelete cascade (events 側): 企画が削除されたら関連レコードも自動削除
 *   (孤立レコード防止)。
 * - onDelete restrict (titles 側、判断 #5): title を削除しようとしたら event_titles
 *   に参照があれば拒否 = master 一貫性維持。title アーカイブ (廃刊等) は
 *   Sprint D の `title_aliases` (venue_aliases 同パターン) で解決する。
 *
 * RLS は同じ migration で `enable row level security` + SELECT 公開 policy 1
 * 本を付与 (anon/authenticated 読み取り公開、書き込み service role のみ)。
 */
export const eventTitles = pgTable(
  'event_titles',
  {
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    titleId: bigint('title_id', { mode: 'number' })
      .notNull()
      .references(() => titles.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.titleId] }),
    // title_id 単独検索用の btree secondary index。composite PK (event_id 先頭)
    // では title_id 単独クエリが leftmost prefix に該当しないため必須。
    index('event_titles_title_idx').on(table.titleId),
  ],
);

export type EventTitleRow = typeof eventTitles.$inferSelect;
export type EventTitleInsert = typeof eventTitles.$inferInsert;
