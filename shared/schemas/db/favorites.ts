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
 * - PK は (auth_user_id, target_type, target_key) の複合。同一対象への重複いいねを
 *   DB レベルで防ぐ。
 * - `auth_user_id` は auth.users(id) を参照し cascade 削除。FK 句は custom SQL
 *   migration 側で付与 (Drizzle は auth スキーマを管理しないため)。
 *
 * ★ 列名について (migration 0011 で `user_id` → `auth_user_id` に改名):
 *   本テーブルの参照先は **auth.users(id)** であって `profiles.id` ではない。
 *   M1 の分離前は `profiles.id = auth.users.id` だったため両者は同値だったが、
 *   分離後は別の ID 空間になる。`reviews.user_id` (= `profiles.id`) と同じ列名の
 *   まま放置すると「同じ名前で別のものを指す」状態が残るため改名した。
 *
 *   いいねを profiles 側に寄せる (= 退会後も残す) 判断は**していない**。
 *   いいねは本人しか見ないため退会と同時に消えてよく、レビュー (永続化対象) とは
 *   要件が違う。BOSS 確定 1: 「auth 紐付け維持 + auth_user_id へ改名」。
 *
 * 注 (RLS): `ENABLE ROW LEVEL SECURITY` + ポリシーも同じ custom SQL migration (0001)
 *   で付与する。Drizzle snapshot の `isRLSEnabled:false` は RLS を custom SQL で管理する
 *   設計上の想定表示で、実 DB では有効 (migrate 運用前提)。
 */
export const favorites = pgTable(
  'favorites',
  {
    // auth.users(id) を参照。FK 句は custom SQL migration 側で付与する。
    // profiles.id (永続 ID) ではないことに注意 (上記 ★)。
    authUserId: uuid('auth_user_id').notNull(),
    // Closed Beta は 'article' 固定。default も 'article'。
    targetType: text('target_type').notNull().default('article'),
    // article は URL path 連結キー (event_type/work_slug/slug)。
    targetKey: text('target_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.authUserId, table.targetType, table.targetKey] }),
    // Closed Beta は article 固定。拡張時に許可値を追加する。
    check('favorites_target_type_allowed', sql`${table.targetType} in ('article')`),
  ],
);

export type FavoriteRow = typeof favorites.$inferSelect;
export type FavoriteInsert = typeof favorites.$inferInsert;
