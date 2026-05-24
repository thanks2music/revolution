import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.favorites
 *
 * Crescendolls 会員機能の「いいね」テーブル。軽量ポリモーフィック設計
 * (hashed-doodling-hopper.md §いいね識別子設計 に準拠)。
 *
 * 設計判断:
 * - `target_type` + `target_key` の軽量ポリモーフィック。Closed Beta は
 *   `'article'` 固定 (CHECK で制約)。将来 `'event'`/`'venue'`/`'work'` を
 *   CHECK の許可値追加 + resolver 追加だけで拡張でき、テーブル作り直し不要。
 * - article の `target_key` = `event_type/work_slug/slug` の URL path 連結キー
 *   (slug 単独は非一意。レガシーは `articles/{slug}` フォールバック)。生成/逆引きは
 *   M3 で Layer1 純粋関数 (buildArticleKey/resolveArticleByKey) として実装する。
 * - PK は (user_id, target_type, target_key) の複合。同一対象への重複いいねを
 *   DB レベルで防ぐ。
 * - `user_id` は auth.users(id) を参照し cascade 削除。FK 句は custom SQL
 *   migration 側で付与 (Drizzle は auth スキーマを管理しないため)。
 */
export const favorites = pgTable(
  'favorites',
  {
    // auth.users(id) を参照。FK 句は custom SQL migration 側で付与する。
    userId: uuid('user_id').notNull(),
    // Closed Beta は 'article' 固定。default も 'article'。
    targetType: text('target_type').notNull().default('article'),
    // article は URL path 連結キー (event_type/work_slug/slug)。
    targetKey: text('target_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.targetType, table.targetKey] }),
    // Closed Beta は article 固定。拡張時に許可値を追加する。
    check('favorites_target_type_allowed', sql`${table.targetType} in ('article')`),
  ],
);

export type FavoriteRow = typeof favorites.$inferSelect;
export type FavoriteInsert = typeof favorites.$inferInsert;
