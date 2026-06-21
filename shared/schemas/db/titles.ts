import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.titles
 *
 * 作品/IP master テーブル。AI Writer / Frontend が作品参照する際の正準。
 * URL セグメント (例: `/titles/jujutsu-kaisen`) と reviews 集計の永続キーとなる。
 *
 * 設計判断 (MVP「Around the World」§11 データモデル基盤先行統合、handoff §3):
 * - `id` は `bigint generated always as identity` の代理キー。slug は URL に
 *   現れるため変更されうるが、event_titles からの FK は ID で張る方針
 *   (Sprint B 以降)。
 * - `slug` は URL 正準。ASCII lowercase + 数字 + ハイフンのみ。
 * - `name` は日本語の表示名。
 * - `name_kana` は名寄せ・検索補助 (任意)。フリガナ。`title_aliases` は
 *   Sprint D で分離実装する別タスク (本テーブルには同居しない)。
 * - `kind` は作品種別の enum。CHECK 制約で許容値を 5 値に固定
 *   (`anime` / `manga` / `game` / `novel` / `other`)。将来追加時は
 *   migration で CHECK を DROP → ADD の 1 migration で対応する。
 * - `created_at` は SSoT v3 全テーブル共通の運用パターン (profiles / venues /
 *   events / occurrences / reviews すべてに付与済) を踏襲。
 *
 * 二段防御 (categories と同様、Layer 3 lower index は ASCII lowercase 固定の
 * ため不要):
 *   slug:
 *     Layer1 = zod (`shared/schemas/title.ts`、`TITLE_SLUG_REGEX` が真実源)
 *     Layer2 = DB CHECK (`slug ~ '^[a-z0-9-]+$'`、本ファイル)
 *   kind:
 *     Layer1 = zod (`TITLE_KIND_VALUES` の enum literal union)
 *     Layer2 = DB CHECK (`kind in (...)`、本ファイル)
 *
 * RLS は同じ migration (`<timestamp>_titles.sql`) で `enable row level
 *   security` + SELECT 公開 policy 1 本だけを付与する (anon/authenticated に
 *   読み取り公開、書き込みは service role のみ)。drizzle pgTable に enableRls
 *   は付与せず、profiles/categories と同様 custom SQL 管理。
 */
export const titles = pgTable(
  'titles',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    nameKana: text('name_kana'),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Layer2: DB CHECK。zod (Layer1) と同じ正規表現を二段防御として保持。
    check('titles_slug_format', sql`${table.slug} ~ '^[a-z0-9-]+$'`),
    // Layer2: DB CHECK。zod (Layer1) と同じ allowed list を二段防御として保持。
    check(
      'titles_kind_allowed',
      sql`${table.kind} in ('anime','manga','game','novel','other')`,
    ),
  ],
);

export type TitleRow = typeof titles.$inferSelect;
export type TitleInsert = typeof titles.$inferInsert;
