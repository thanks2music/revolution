-- ============================================================================
-- Migration 0006: Narrow GRANTs per exact RLS policy scope
-- ============================================================================
-- 二つの残余問題を single migration で収束させる:
--
-- ## 問題 A: PR #258 の staging version-drift
--
-- Migration 0005 は同一 version (`20260705153608`) 内で 2 度書き直された。
-- 1 回目 (broad grant 版) が staging 側の deploy pipeline (PR event) で先に
-- 適用された結果、`supabase_migrations.schema_migrations` に applied として
-- 記録され、2 回目 (least-privilege 版) の再 push は `supabase db push` が
-- 「既適用」と判定してスキップ。
--
-- 結果:
--   - production: 2 回目 (least-privilege) のみ適用 = 目標状態
--   - staging: 1 回目 (broad grant) のみ適用 = 5 tables × 3 roles × CRUD 全付与
--
-- 本 migration の REVOKE ALL + 明示 GRANT で **staging を目標状態に強制収束**、
-- production は idempotent no-op (実質差分ゼロ)。
--
-- ## 問題 B: PR #258 claude[bot] 2 巡目 Finding
--
-- Migration 0005 は profiles / favorites 双方に SELECT/INSERT/UPDATE/DELETE を
-- 一括 GRANT していたが、実 RLS policy scope はそれより狭い:
--
--   | table     | RLS policy scope                       |
--   |-----------|----------------------------------------|
--   | profiles  | SELECT / INSERT / UPDATE (no DELETE)   |
--   | favorites | SELECT / INSERT / DELETE (no UPDATE)   |
--
-- 現状の profiles.DELETE / favorites.UPDATE grant は「RLS policy が honor しない
-- dead grant」であり、RLS を将来誤って停止した場合の blast radius を無用に
-- 拡大する。本 migration で per-table 単位で RLS policy scope に厳密に一致させる。
--
-- ## Reference master tables (categories / titles / venues) は変更なし
--
-- 0005 の書き直し版で既に least-privilege 状態 (anon+authenticated = SELECT
-- only、service_role = ALL)。本 migration は idempotent に同じ状態を宣言する
-- だけ。ここも REVOKE ALL → GRANT で staging の drift を同時修正する。
--
-- ## ALTER DEFAULT PRIVILEGES は変更なし
--
-- 0005 の書き直し版で既に `FOR ROLE postgres IN SCHEMA public` に SELECT (anon
-- +authenticated) / ALL (service_role) の default privileges を追加済。本
-- migration では触れない。もし staging に反映されていないなら本 migration が
-- 再度冪等に追加する。
--
-- ## claude[bot] Finding #3 (pgTAP regression test) について
--
-- 本 version-drift 事案は「同一 version で SQL 内容が変わった場合の drift
-- 検知」も pgTAP タスク ([`6h3Pvp2JQCm4Mcx8`](https://app.todoist.com/app/task/6h3Pvp2JQCm4Mcx8))
-- のスコープに含めて追跡。CI が PR 段階で grant assertion を実行することで、
-- 今回のような「PR-time file != main-branch file」ドリフトも検知可能になる。
-- ============================================================================

-- ============================================================================
-- (1) 既存 grant の再初期化 (staging drift 撤回 + production idempotent)
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
-- (2b) profiles: authenticated には SELECT / INSERT / UPDATE のみ (no DELETE)
--       RLS policy: SELECT_own / INSERT_own / UPDATE_own to authenticated
--       (DELETE は退会=cascade/admin 経由、authenticated には露出しない)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE
    ON TABLE public.profiles
    TO authenticated;
--> statement-breakpoint

GRANT ALL
    ON TABLE public.profiles
    TO service_role;
--> statement-breakpoint

-- ============================================================================
-- (2c) favorites: authenticated には SELECT / INSERT / DELETE のみ (no UPDATE)
--       RLS policy: SELECT_own / INSERT_own / DELETE_own to authenticated
--       (UPDATE は favorites の性質上不要 = ON/OFF のトグルは INSERT + DELETE)
-- ============================================================================
GRANT SELECT, INSERT, DELETE
    ON TABLE public.favorites
    TO authenticated;
--> statement-breakpoint

GRANT ALL
    ON TABLE public.favorites
    TO service_role;
