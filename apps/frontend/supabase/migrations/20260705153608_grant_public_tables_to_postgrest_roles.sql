-- ============================================================================
-- Migration 0005: Grant CRUD on public tables to PostgREST roles
-- ============================================================================
-- Backlog D (PR #256) post-merge smoke test で staging keep-alive workflow が
-- HTTP 401 を返した件の恒久対策。
--
-- 原因: staging project の app tables (categories / titles / venues / profiles /
-- favorites) に対して PostgREST が使用する anon/authenticated role へ
-- CRUD 権限が付与されていなかった (production は BOSS 手動 GRANT 済で問題化
-- していない)。PostgREST 応答: `code=42501 permission denied for table
-- categories`。RLS policy は正常だが、Postgres レベルの GRANT がその前段に必要。
--
-- 修正:
-- (1) 既存 5 テーブル (categories / titles / venues / profiles / favorites) に
--     対して anon / authenticated / service_role へ CRUD 権限を明示付与。
--     RLS policy が実質の行アクセス制御を担うため、CRUD 4 種すべて付与しても
--     セキュリティは RLS 側で担保される。
-- (2) 再発防止として ALTER DEFAULT PRIVILEGES を明示追加。以降 public schema
--     に作成される新規テーブルは自動的に 3 role へ CRUD 権限が付与される。
--
-- 冪等: production は既に付与済のため実質 no-op。両環境で post-apply の
-- `information_schema.role_table_grants` が identical になる。
--
-- Drizzle SSoT は GRANT / DEFAULT PRIVILEGES を扱わないため、本 migration は
-- 手動 SQL のみで完結する (0001_crescendolls_rls.sql と同じパターン)。
-- ============================================================================

-- (1) 既存 app tables に GRANT (冪等)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.categories, public.titles, public.venues,
           public.profiles, public.favorites
  TO anon, authenticated, service_role;
--> statement-breakpoint

-- (2) 今後 public schema に追加されるテーブルへの default privileges 明示
--     (Supabase project 初期化時に自動設定されるべき
--      ALTER DEFAULT PRIVILEGES が staging では有効化されていなかった
--      副産物への対策)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLES TO anon, authenticated, service_role;
