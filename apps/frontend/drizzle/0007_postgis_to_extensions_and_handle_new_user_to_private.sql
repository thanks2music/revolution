-- ============================================================================
-- Migration 0007: PostGIS -> extensions schema + handle_new_user -> private
-- ============================================================================
-- 案 Y (Supabase Advisor 10 件束ね解消) 実装。詳細は
-- one-more-time/docs/handoff/2026-07-05-backlog-c-postgis-extensions-handle-new-user-handoff.md
-- を参照。
--
-- 【PostGIS 側 8 件解消】
--   0004 で `CREATE EXTENSION IF NOT EXISTS postgis` が `WITH SCHEMA` 未指定
--   により `public` schema にインストールされたことで、以下 8 lints が発生:
--     - rls_disabled_in_public (public.spatial_ref_sys, ERROR)
--     - extension_in_public (postgis, WARN)
--     - anon/authenticated_security_definer_function_executable
--       (public.st_estimatedextent 3 overloads × 2 roles = 6 lints, WARN)
--   canonical fix = DROP EXTENSION CASCADE + CREATE EXTENSION WITH SCHEMA
--   (PostGIS 2.3+ で `ALTER EXTENSION SET SCHEMA` は非対応、Supabase 公式明記
--    https://supabase.com/docs/guides/database/extensions/postgis)。
--
-- 【handle_new_user 側 2 件解消】
--   PR #244 (Crescendolls 本番有効化) で public 配置 + SECURITY DEFINER 露出:
--     - anon/authenticated_security_definer_function_executable
--       (public.handle_new_user, WARN × 2)
--   canonical fix = private schema へ移動 + REVOKE public/anon/authenticated
--   + GRANT service_role のみ (trigger 経由の実行のみ許可)。
--   関数本体は既に `SET search_path = ''` + fully qualified 参照が設定済
--   (staging + production 実装で確認、handoff §3.2 の canonical パターン準拠)。
--
-- 【重要な前提】
--   - venues.geo は空 seed = DROP COLUMN + ADD COLUMN で退避 & 再作成 safe。
--   - migration 0004 の retroactive 編集は禁止 (PR #250 SoP §9)、forward
--     migration 0007 のみで手術。
--   - 単一 migration + DDL は暗黙 transactional (PostgreSQL) = atomic 適用。
--   - handle_new_user() の元実装 (pg_get_functiondef で取得、staging +
--     production 完全一致): id + display_name (from full_name COALESCE '')
--     + username (NULL) の 3 カラム insert。本 migration で忠実移植する。
-- ============================================================================

-- ============================================================================
-- Part A: extensions schema の準備
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
--> statement-breakpoint

-- ============================================================================
-- Part B: venues.geo カラムの退避 (DROP EXTENSION CASCADE で消失前に)
-- ============================================================================
-- venues.geo は空 seed の設計 (0004 で導入以来 AI Writer 動的追加方針、
-- 2026-07-05 時点で staging + production ともに 0 rows を確認済)。
-- ただし authoring 時点と apply 時点の window で非決定的挿入 (手動 INSERT、
-- backfill、先行 PR 由来のデータ流入等) が起きた場合の**静かなデータ消失**を防ぐ
-- ため、DO $$ ブロックで precondition を hard-check する (claude[bot] R1
-- Finding 1 採用、防御深化)。エラー時は同一 migration の後続 DDL 全てが
-- transactional rollback される (PostgreSQL の暗黙 DDL transaction)。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.venues WHERE geo IS NOT NULL) THEN
    RAISE EXCEPTION
      'Migration 0007 aborted: public.venues.geo has non-null rows. '
      'Persistent PostGIS data would be silently destroyed by '
      'DROP EXTENSION postgis CASCADE. Backup the geo column and '
      'rewrite migration 0007 to preserve data before retrying.';
  END IF;
END $$;
--> statement-breakpoint

-- CASCADE で GiST index venues_geo_gist_idx も消失するので Part D で再作成。
ALTER TABLE "public"."venues" DROP COLUMN "geo";
--> statement-breakpoint

-- ============================================================================
-- Part C: PostGIS の再インストール (extensions schema へ)
-- ============================================================================
-- DROP EXTENSION CASCADE で以下を drop:
--   - spatial_ref_sys (SRID 標準辞書テーブル、public に露出していた ERROR 元)
--   - geometry_columns / geography_columns (view)
--   - st_* 関数群 (数百個、st_estimatedextent の 3 overload 含む)
--   - GiST operator class + venues_geo_gist_idx
DROP EXTENSION postgis CASCADE;
--> statement-breakpoint

CREATE EXTENSION postgis WITH SCHEMA extensions;
--> statement-breakpoint

-- ============================================================================
-- Part D: venues.geo の再作成 (qualified reference)
-- ============================================================================
ALTER TABLE "public"."venues"
  ADD COLUMN "geo" extensions.geography(point, 4326);
--> statement-breakpoint

-- GiST index を再作成 (Part C の CASCADE で消失)。
-- PostGIS operator class は extension 再インストール後に自動的に有効。
CREATE INDEX "venues_geo_gist_idx" ON "public"."venues" USING gist ("geo");
--> statement-breakpoint

-- ============================================================================
-- Part E: private schema の準備
-- ============================================================================
-- handle_new_user() の SECURITY DEFINER 関数を PostgREST から不可視化するための
-- 非公開 schema。Supabase 公式パターン:
--   https://supabase.com/docs/guides/local-development/testing/pgtap-extended
CREATE SCHEMA IF NOT EXISTS private;
--> statement-breakpoint

-- ============================================================================
-- Part F: handle_new_user() の private schema への移動
-- ============================================================================
-- 元 public.handle_new_user() のロジックを忠実移植 (pg_get_functiondef で
-- staging + production から取得、両環境完全一致を確認)。
-- SET search_path = '' で search_path hijack 攻撃を防止。
-- INSERT 先の public.profiles は fully qualified で参照。
-- display_name は auth.users.raw_user_meta_data の full_name から派生
-- (COALESCE で NULL → '' フォールバック)。username は onboarding 完了まで NULL。
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO "public"."profiles" ("id", "display_name", "username")
  VALUES (
    NEW."id",
    COALESCE(NEW."raw_user_meta_data" ->> 'full_name', ''),
    NULL
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ============================================================================
-- Part G: trigger の差し替え + 旧 public.handle_new_user() の除去
-- ============================================================================
-- trigger を新 private.handle_new_user() に切り替え (atomic、DDL transaction 内)。
-- signup 中の race condition は DDL trigger switch と INSERT が同一 transaction
-- で serialize されるため発生しない。
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();
--> statement-breakpoint

-- 旧 public.handle_new_user() の execute 権限を撤回してから drop
-- (defense-in-depth、drop 直前の execute race を避ける)。
REVOKE EXECUTE ON FUNCTION "public"."handle_new_user"() FROM public, anon, authenticated;
--> statement-breakpoint

DROP FUNCTION "public"."handle_new_user"();
--> statement-breakpoint

-- 新 private.handle_new_user() は service_role のみ実行可
-- (trigger 経由の実行は search_path/security_definer チェーンで通る、
--  Supabase 公式 [managing-user-data](https://supabase.com/docs/guides/auth/managing-user-data) 準拠)。
REVOKE EXECUTE ON FUNCTION private.handle_new_user() FROM public;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.handle_new_user() TO service_role;
