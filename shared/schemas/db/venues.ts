import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.venues
 *
 * 会場 master テーブル。Sprint B 以降の events / occurrences から FK で参照される
 * 永続マスタ。AI Writer / Frontend の地図表示・距離計算・都道府県別フィルタの
 * 永続キーとなる。
 *
 * 設計判断 (MVP「Around the World」§11 データモデル基盤先行統合、handoff §3):
 * - `id` は `bigint generated always as identity` の代理キー (categories /
 *   titles と同パターン)。slug は URL に現れるため変更されうるが、events から
 *   の FK は ID で張る方針 (Sprint B 以降)。
 * - `slug` は URL 正準。Phase 2-a `titles_slug_format` と同正規表現で
 *   ASCII lowercase + 数字 + ハイフンのみ。先頭/末尾/連続ハイフン禁止。
 * - `name` は日本語の表示名。空白のみは表示が壊れるため拒否。
 * - `prefecture` / `city` / `address` は探索性のため任意 (NULL 許容)。47 都道府県
 *   enum 化は Sprint D で都道府県別フィルタ実装時に再評価 (海外対応も視野)。
 * - `geo` は PostGIS `geography(point, 4326)` 型。WGS84 緯度経度の球面ジオメトリ
 *   で地図表示・距離計算に使用。`customType` で宣言 (drizzle-orm の標準型に
 *   含まれないため)。型レベルで POINT 以外を拒否するため、Phase 2-a 流の追加
 *   CHECK 制約は不要。
 * - `created_at` は SSoT v3 全テーブル共通の運用パターン (profiles / categories
 *   / titles / events / occurrences / reviews) を踏襲。
 *
 * 二段防御 (Layer 1 zod + Layer 2 DB CHECK、Phase 2-a 継承):
 *   slug:
 *     Layer1 = zod (`shared/schemas/venue.ts`、`VENUE_SLUG_REGEX` が真実源)
 *     Layer2 = DB CHECK (本ファイル、Layer 1 と同正規表現)
 *   name:
 *     Layer1 = zod (`.trim().min(1)`)
 *     Layer2 = DB CHECK (`btrim(name) <> ''`)
 *   prefecture / city / address:
 *     Layer1 = zod (`.min(1).nullable().optional()`、値ありなら空文字拒否)
 *     Layer2 = DB CHECK なし (NULL 許容 + 47 enum 化遅延の判断、handoff §3.C)
 *
 * PostGIS extension は同じ migration (`<timestamp>_venues.sql`) の冒頭で
 *   `create extension if not exists postgis;` を手動追記する (drizzle-kit
 *   自動生成範囲外、custom SQL 管理 = RLS と同パターン)。
 *
 * RLS は同じ migration で `enable row level security` + SELECT 公開 policy 1
 *   本だけを付与する (anon/authenticated に読み取り公開、書き込みは service
 *   role のみ)。drizzle pgTable に enableRls は付与せず、profiles / categories
 *   / titles と同様 custom SQL 管理。
 *
 * 名寄せ補助 (venue_aliases) は Sprint D (Release: Random Access Memories) で
 *   分離実装する別タスク (本テーブルには同居しない)。
 */

/**
 * PostGIS `geography(point, 4326)` の Drizzle customType 宣言。
 *
 * SSoT v3 (`docs/schema/revolution-schema.ts` 想定定義) と一致。`{ data: string }`
 * は WKT (Well-Known Text、`POINT(139.7670 35.6812)`) または WKB 16 進文字列で
 * AI Writer / アプリケーション側から投入する想定。詳細検証は Layer 1 では
 * 行わず、PostGIS 関数 (`ST_GeogFromText` 等) と DB の型システムに委ねる。
 *
 * 公式: https://orm.drizzle.team/docs/custom-types
 * PostGIS geography: https://postgis.net/docs/manual-3.4/using_postgis_dbmanagement.html#PostGIS_Geography
 *
 * 3 つ目のテーブルが geography を使う時点で `shared/schemas/db/_shared/geography.ts`
 * へ抽出する (rule-of-3、現時点は venues 単独使用のため内部宣言)。
 */
const geography = customType<{ data: string }>({
  dataType() {
    return 'geography(point, 4326)';
  },
});

export const venues = pgTable(
  'venues',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    prefecture: text('prefecture'),
    city: text('city'),
    address: text('address'),
    geo: geography('geo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Layer2: DB CHECK。zod (Layer1) と同じ正規表現を二段防御として保持。
    // 先頭/末尾/連続ハイフン禁止 (URL 正準化、SEO 安全、Phase 2-a 継承)。
    check('venues_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // Layer2: DB CHECK。空白のみの表示名を拒否 (Phase 2-a 継承)。
    check('venues_name_not_blank', sql`btrim(${table.name}) <> ''`),
  ],
);

export type VenueRow = typeof venues.$inferSelect;
export type VenueInsert = typeof venues.$inferInsert;
