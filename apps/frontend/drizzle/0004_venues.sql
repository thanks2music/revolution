-- ============================================================================
-- Migration 0004: venues master CREATE + PostGIS extension 有効化 + GiST index
-- ============================================================================
-- 本 migration は 3 つの変更を 1 トランザクションで適用する:
-- (1) PostGIS extension の有効化 (`CREATE EXTENSION IF NOT EXISTS postgis`)
-- (2) public.venues テーブル新規作成 (MVP Around the World §11 Phase 2-b)
-- (3) venues.geo の GiST 空間インデックス
--     (PostGIS geography predicates (ST_DWithin / ST_Distance 等) は B-tree
--      不可、GiST 必須。claude[bot] review Finding 1 受け)
--
-- PostGIS extension は venues.geo の geography(point, 4326) 型に必要。
-- Supabase Free プランで有効化可能 (公式:
-- https://supabase.com/docs/guides/database/extensions/postgis)。
-- drizzle-kit は CREATE EXTENSION を自動生成しないため冒頭に手動追記する
-- (RLS と同じく custom SQL 管理として割り切る)。
--
-- 完了 = Sprint A 最終子 (3/3) = MVP (Around the World) 第 1 段階達成。
-- ============================================================================

-- ============================================================================
-- (1) PostGIS extension (手動追記、drizzle-kit 自動生成範囲外)
-- ============================================================================
-- geo 列の geography(point, 4326) 型を有効化するため。
-- 公式: https://supabase.com/docs/guides/database/extensions/postgis
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint

-- ============================================================================
-- (2) venues テーブル本体 (drizzle-kit 自動生成、geo 列の型は手動で quote 解除)
-- ============================================================================
-- 注: drizzle-kit の customType<{ data: string }> 出力は `"geography(point, 4326)"`
-- のように型名全体を quote するが、PostgreSQL では型として認識できないため
-- 手動で quote を解除している (Supabase mirror と zero-diff)。
CREATE TABLE "venues" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "venues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"prefecture" text,
	"city" text,
	"address" text,
	"geo" geography(point, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug"),
	CONSTRAINT "venues_slug_format" CHECK ("venues"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "venues_name_not_blank" CHECK (btrim("venues"."name") <> '')
);
--> statement-breakpoint
CREATE INDEX "venues_geo_gist_idx" ON "venues" USING gist ("geo");
--> statement-breakpoint

-- ============================================================================
-- (3) RLS 有効化 + SELECT 公開 policy (手動追記、drizzle-kit 自動生成範囲外)
-- ============================================================================
--
-- venues は master データのため全ユーザーから read 可能、書き込みは
-- service role のみ (= INSERT/UPDATE/DELETE の policy を作らないことで実現)。
-- Supabase ベストプラクティス: https://supabase.com/docs/guides/database/postgres/row-level-security
-- 既存 profiles / favorites / categories / titles の RLS と整合: 同様に custom SQL で管理。
--
-- 初期 seed は投入しない (Phase 2-a と同方針、AI Writer 動的追加設計)。
-- 地理座標は AI Writer pipeline 内で取得する経路が正、手動 seed は最終的に
-- 上書き or 重複の元になるため空 seed が一貫している。

ALTER TABLE "public"."venues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "venues_select_all"
  ON "public"."venues"
  FOR SELECT
  TO anon, authenticated
  USING (true);
