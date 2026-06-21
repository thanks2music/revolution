import { bigint, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.categories
 *
 * イベントタイプ master テーブル。AI Writer が記事生成時に出力する正準 slug
 * (`collabo-cafe` / `pop-up-store` / `exhibition` 等 23 種) の真実源。
 *
 * 設計判断 (MVP「Around the World」§11 データモデル基盤先行統合):
 * - `id` は `bigint generated always as identity` の代理キー。slug は URL に
 *   現れるため変更されうるが、events / event_categories からの FK は ID で
 *   張る方針 (Sprint B 以降)。
 * - `slug` は URL 正準。ASCII lowercase + ハイフンのみ。unique 制約は本ファイル
 *   (DB) で担保し、Layer1 zod (`shared/schemas/category.ts`) で
 *   regex (`CATEGORY_SLUG_REGEX`) を二段防御として保持する。
 * - `name` は日本語の代表名 1 つだけ。同義語マッピング (「カフェコラボ →
 *   collabo-cafe」等) は revolution-templates 側 (`event-type-slugs.yaml`) の
 *   責務であり、DB master には入れない (SoC 遵守)。
 *
 * RLS は同じ migration (`<timestamp>_categories.sql`) で `enable row level
 *   security` + SELECT 公開 policy 1 本だけを付与する (anon/authenticated に
 *   読み取り公開、書き込みは service role のみ)。drizzle pgTable に enableRls
 *   は付与せず、profiles/favorites と同様 custom SQL 管理。
 */
export const categories = pgTable('categories', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

export type CategoryRow = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;
