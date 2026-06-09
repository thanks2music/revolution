-- Custom SQL migration file, put your code below! --
-- Crescendolls 会員機能: FK (auth.users) + handle_new_user トリガー + RLS
--
-- このファイルは drizzle-kit が生成しない部分 (auth スキーマ参照・トリガー・RLS) を
-- 手書きする custom SQL migration。0000_crescendolls_tables.sql で作成した
-- public.profiles / public.favorites に対して適用する。
--
-- 適用対象: ローカル `supabase start` の DB (postgresql://postgres:postgres@127.0.0.1:54322/postgres)
-- remote (ref=abqsntbvnuttpyixagob) へ自律適用は禁止 (ハーネス絶対制約)。
--
-- 設計判断 (hashed-doodling-hopper.md §データモデル / spec.md §M1 に準拠):
--   - handle_new_user は `security definer set search_path = ''`。auth.users insert で
--     profiles を空作成 (display_name = coalesce(raw_user_meta_data->>'full_name',''),
--     username = NULL)。
--   - RLS: profiles/favorites とも `(select auth.uid()) = id/user_id`、`to authenticated`。
--     email 判定は `auth.jwt()->>'email'` (auth.email() 不使用)。
--   - profiles は select も本人のみ (公開ページ v2)。profiles に delete ポリシーは作らない
--     (退会は cascade/admin)。favorites は本人 select/insert/delete。

-- ============================================================================
-- 1. FK: public スキーマのテーブルから auth.users(id) への参照 (on delete cascade)
-- ============================================================================
-- Drizzle は auth スキーマを管理しないため、FK 句はここで張る。

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_auth_users_fk"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "public"."favorites"
  ADD CONSTRAINT "favorites_user_id_auth_users_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- ============================================================================
-- 2. handle_new_user(): auth.users insert で profiles を空作成するトリガー関数
-- ============================================================================
-- security definer + set search_path = '' (Supabase 公式のセキュリティ推奨):
--   - search_path を空にすることで、悪意あるスキーマ注入による関数乗っ取りを防ぐ。
--   - そのため関数内のすべてのオブジェクト参照は完全修飾 (public.profiles 等) にする。
-- display_name は coalesce で空文字埋め (NOT NULL を満たす)、username は NULL
-- (= onboarding 未完了)。サインアップが必ず成功するよう副作用を最小化する。

CREATE OR REPLACE FUNCTION "public"."handle_new_user"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

-- 冪等性のため既存トリガーを落としてから作成 (migration 再適用耐性)。
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
--> statement-breakpoint

CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."handle_new_user"();
--> statement-breakpoint

-- ============================================================================
-- 3. RLS 有効化
-- ============================================================================

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."favorites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ============================================================================
-- 4. RLS ポリシー: profiles (本人のみ select / insert / update。delete なし)
-- ============================================================================
-- (select auth.uid()) でラップするのは Supabase 公式の最適化推奨 (per-row 評価の回避)。
-- to authenticated でログインユーザーに限定 (anon は対象外)。
-- profiles は公開ページ v2 のため select も本人限定。

-- 本人プロフィールの参照のみ許可。
CREATE POLICY "profiles_select_own"
  ON "public"."profiles"
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = "id");
--> statement-breakpoint

-- handle_new_user は security definer のため RLS をバイパスして insert するが、
-- 念のためアプリ経由 insert も本人 id のみ許可する (二重防御)。
CREATE POLICY "profiles_insert_own"
  ON "public"."profiles"
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = "id");
--> statement-breakpoint

-- onboarding / マイページでの更新は本人行のみ。USING (対象行) と
-- WITH CHECK (更新後の値) の両方で本人 id を強制し、他人への付け替えを防ぐ。
CREATE POLICY "profiles_update_own"
  ON "public"."profiles"
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = "id")
  WITH CHECK ((SELECT auth.uid()) = "id");
--> statement-breakpoint

-- ============================================================================
-- 5. RLS ポリシー: favorites (本人のみ select / insert / delete)
-- ============================================================================

CREATE POLICY "favorites_select_own"
  ON "public"."favorites"
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = "user_id");
--> statement-breakpoint

CREATE POLICY "favorites_insert_own"
  ON "public"."favorites"
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = "user_id");
--> statement-breakpoint

CREATE POLICY "favorites_delete_own"
  ON "public"."favorites"
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = "user_id");
