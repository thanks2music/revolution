-- ============================================================================
-- Migration 0005: Least-privilege GRANTs for PostgREST roles
-- ============================================================================
-- Backlog D (PR #256) post-merge smoke test で staging keep-alive workflow が
-- HTTP 401 を返した件の恒久対策。追加で PR #258 claude[bot] review Findings
-- 1 / 2 / 4 を採用し、single migration で最終的な least-privilege 状態へ
-- 両環境を収束させる。
--
-- ## 原因
--
-- staging project の app tables (categories / titles / venues / profiles /
-- favorites) に対して PostgREST が使用する anon / authenticated role へ
-- CRUD 権限が付与されていなかった。production は全 CRUD 付与済 (BOSS 手動 GRANT
-- 経緯) で問題化していない。PostgREST 応答:
-- `code=42501 permission denied for table categories`。
-- RLS policy は正常だが、Postgres レベルの GRANT がその前段に必要。
--
-- ## 修正方針 (Supabase 公式 least-privilege パターン)
--
-- Supabase docs (以下複数箇所で同一パターンを明示):
--   - https://supabase.com/docs/guides/auth/managing-user-data
--   - https://supabase.com/docs/reference/dart/introduction
--   - https://supabase.com/docs/reference/csharp
--
-- 「anon には SELECT のみ、authenticated には CRUD、service_role には ALL」
-- を基本とし、テーブル毎の RLS policy scope に合わせて更に絞る。
--
-- ## 本 project の RLS policy scope (production 実測、staging と identical)
--
-- | table       | RLS policy scope                            |
-- |-------------|---------------------------------------------|
-- | categories  | SELECT TO anon, authenticated (public data) |
-- | titles      | SELECT TO anon, authenticated (public data) |
-- | venues      | SELECT TO anon, authenticated (public data) |
-- | profiles    | SELECT/INSERT/UPDATE TO authenticated only  |
-- | favorites   | SELECT/INSERT/DELETE TO authenticated only  |
--
-- ## 適用後の目標状態 (両環境 identical)
--
-- - Reference masters (categories / titles / venues):
--     anon, authenticated  : SELECT only
--     service_role         : ALL
-- - Per-user data (profiles / favorites):
--     anon                 : **なし** (RLS policy がそもそも anon 対象外)
--     authenticated        : SELECT, INSERT, UPDATE, DELETE
--     service_role         : ALL
--
-- ## 冪等 / 収束性
--
-- REVOKE ALL で両環境の既存 grant を初期化してから明示 GRANT する。
-- - staging: REVOKE は no-op (元々なし) + 明示 GRANT で目標状態
-- - production: REVOKE で過剰権限 (anon INSERT/UPDATE/DELETE) を撤回、
--   その後 GRANT で目標状態
--
-- ## ALTER DEFAULT PRIVILEGES (Finding 2 採用: FOR ROLE postgres 明示)
--
-- deploy-supabase-migrations.yml は session pooler で `postgres` role として
-- migration を適用する (`postgresql://postgres.<ref>@aws-...pooler...`)。
-- ALTER DEFAULT PRIVILEGES は「default privileges を設定した role が今後
-- 作成するオブジェクト」のみに影響する仕様 (Postgres 公式):
--   https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
-- `FOR ROLE postgres` を明示することで他 role で誤って作られたテーブルへの
-- 副作用を封じ、self-documenting にする。
--
-- 新規テーブルの default は SELECT-only (anon/authenticated) にして、書き込みが
-- 必要な場合は per-migration で明示 GRANT を強制する (誤爆リスク最小化)。
--
-- Drizzle SSoT は GRANT / DEFAULT PRIVILEGES を扱わないため、本 migration は
-- 手動 SQL のみで完結する (0001_crescendolls_rls.sql と同じパターン)。
-- ============================================================================

-- ============================================================================
-- (1) 既存 grant の初期化 (REVOKE ALL) — 両環境で収束するため
-- ============================================================================
REVOKE ALL ON TABLE
    public.categories, public.titles, public.venues,
    public.profiles,   public.favorites
  FROM anon, authenticated;
--> statement-breakpoint

-- ============================================================================
-- (2a) Reference master tables: anon / authenticated には SELECT のみ
-- ============================================================================
GRANT SELECT
    ON TABLE public.categories, public.titles, public.venues
    TO anon, authenticated;
--> statement-breakpoint

GRANT ALL
    ON TABLE public.categories, public.titles, public.venues
    TO service_role;
--> statement-breakpoint

-- ============================================================================
-- (2b) Per-user data tables: authenticated のみ CRUD、anon 一切なし
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.profiles, public.favorites
    TO authenticated;
--> statement-breakpoint

GRANT ALL
    ON TABLE public.profiles, public.favorites
    TO service_role;
--> statement-breakpoint

-- ============================================================================
-- (3) 再発防止: ALTER DEFAULT PRIVILEGES (FOR ROLE postgres 明示)
-- ============================================================================
-- 新規テーブルは自動的に SELECT のみ anon/authenticated に付与。
-- INSERT/UPDATE/DELETE は「per-migration で明示 GRANT する」ことを default 挙動
-- として強制。service_role は常に ALL。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT ON TABLES TO anon, authenticated;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;
