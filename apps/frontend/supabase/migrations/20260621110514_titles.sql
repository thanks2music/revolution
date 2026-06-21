-- ============================================================================
-- Migration 0003: titles master CREATE + categories CHECK 制約強化 (retrofit)
-- ============================================================================
-- 本 migration は 2 つの変更を 1 トランザクションで適用する:
-- (1) public.titles テーブル新規作成 (MVP Around the World §11 Phase 2-a)
-- (2) public.categories の CHECK 制約強化 (PR #249 code review #2/#3 反映、
--     PR #247 で初期作成された本テーブルへの retrofit ALTER)
--
-- 既存 categories 23 行は新 CHECK 制約をすべて通過 (検証済): slug は word-
-- hyphen-word のみで先頭/末尾/連続ハイフンなし、name はすべて非空白。
-- ============================================================================

CREATE TABLE "titles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "titles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_kana" text,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "titles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "titles_slug_format" CHECK ("titles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "titles_name_not_blank" CHECK (btrim("titles"."name") <> ''),
	CONSTRAINT "titles_name_kana_not_blank" CHECK ("titles"."name_kana" is null or btrim("titles"."name_kana") <> ''),
	CONSTRAINT "titles_kind_allowed" CHECK ("titles"."kind" in ('anime','manga','game','novel','other'))
);
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_slug_format";--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_not_blank" CHECK (btrim("categories"."name") <> '');--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_format" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
--> statement-breakpoint

-- ============================================================================
-- 以下は手動追記 (drizzle-kit 自動生成範囲外): titles の RLS 有効化 + SELECT 公開 policy
-- ============================================================================
--
-- titles は master データのため全ユーザーから read 可能、書き込みは
-- service role のみ (= INSERT/UPDATE/DELETE の policy を作らないことで実現)。
-- Supabase ベストプラクティス: https://supabase.com/docs/guides/database/postgres/row-level-security
-- 既存 profiles/favorites/categories RLS との整合: 同様に custom SQL で管理。
--
-- 初期 seed は投入しない (PR #249 code review #1 受け、handoff §3.C 代替案
-- 「AI Writer が逐次追加する設計」採用)。ローカル動作確認用のサンプル
-- データは Phase 2-b 着手前に別途 `__seed__` infra (PR #228 パターン) で
-- 整備予定。

ALTER TABLE "public"."titles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "titles_select_all"
  ON "public"."titles"
  FOR SELECT
  TO anon, authenticated
  USING (true);