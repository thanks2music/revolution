import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, text } from 'drizzle-orm/pg-core';

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
 * - `slug` は URL 正準。ASCII lowercase + 数字 + ハイフンのみ。先頭/末尾/連続
 *   ハイフン (例: `-foo` / `foo-` / `--`) は URL 正準化の観点で禁止。
 * - `name` は日本語の代表名 1 つだけ。空白のみは表示が壊れるため拒否。
 *   同義語マッピング (「カフェコラボ → collabo-cafe」等) は
 *   revolution-templates 側 (`event-type-slugs.yaml`) の責務であり、DB master
 *   には入れない (SoC 遵守)。
 *
 * 二段防御 (Layer 1 zod + Layer 2 DB CHECK、profiles の三段防御と同様、
 * Layer 3 は ASCII lowercase 固定のため不要):
 *   slug:
 *     Layer1 = zod (`shared/schemas/category.ts`、`CATEGORY_SLUG_REGEX` が真実源)
 *     Layer2 = DB CHECK (本ファイル、Layer 1 と同正規表現)
 *   name:
 *     Layer1 = zod (`.trim().min(1)`)
 *     Layer2 = DB CHECK (`btrim(name) <> ''`)
 *
 * RLS は同じ migration (`<timestamp>_categories.sql`) で `enable row level
 *   security` + SELECT 公開 policy 1 本だけを付与する (anon/authenticated に
 *   読み取り公開、書き込みは service role のみ)。drizzle pgTable に enableRls
 *   は付与せず、profiles/favorites と同様 custom SQL 管理。
 *
 * 注: 制約強化 (slug 厳格化 + name 空白拒否) は PR #249 で `0004_*` migration
 * により ALTER で適用 (PR #247 で初期作成された本テーブルへの追従)。
 */
export const categories = pgTable(
  'categories',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
  },
  (table) => [
    // Layer2: DB CHECK。zod (Layer1) と同じ正規表現を二段防御として保持。
    // 先頭/末尾/連続ハイフン禁止 (URL 正準化、SEO 安全)。
    check('categories_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // Layer2: DB CHECK。空白のみの表示名を拒否。
    check('categories_name_not_blank', sql`btrim(${table.name}) <> ''`),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;
