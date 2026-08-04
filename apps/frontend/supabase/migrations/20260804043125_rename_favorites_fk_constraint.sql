-- ============================================================================
-- 0011 の積み残し — favorites の FK 制約名を実態に追随させる
-- ============================================================================
--
-- 0011 のステップ 9 で favorites.user_id を auth_user_id へ改名し、9b で複合 PK の
-- 制約名も追随させた。しかし **FK の制約名だけが旧名のまま残っていた**
-- (claude[bot] PR #286 レビュー指摘)。
--
-- staging 実測 (2026-08-04):
--   PK  favorites_auth_user_id_target_type_target_key_pk  PRIMARY KEY (auth_user_id, ...)  ← 追随済み
--   FK  favorites_user_id_auth_users_fk                   FOREIGN KEY (auth_user_id) ...   ← 名前が実態と食い違う
--
-- 機能上の実害はない。またこの FK は auth.users を参照するため Drizzle 側で
-- モデル化されておらず、drizzle-kit の drift としても現れない。
-- ただし **0011 が PK について明示的に直したのと同じ「名前が実態を偽る」状態**が
-- 残っており、将来の読み手を誤解させる。一貫性のために揃える。
--
-- ★ なぜ 0011 を直接編集せず新しい migration を足すのか:
--   0011 は既に staging へ適用済み (schema_migrations に 20260804024648 が記録済み)。
--   同一 version のファイル内容を差し替えても、CLI は「適用済み」と判定して
--   再実行しないため、**ローカルのファイル内容と実 DB が永久に食い違う**。
--   これは PR #258 / #259 で実際に発生し記録された drift 事案そのもの。
--   SoP: docs/operations/supabase-migration-workflow.md §9
--   ("do NOT rename or delete a migration file that has already been deployed
--     to a remote. Add a NEW migration to make further changes.")
--
-- ★ RENAME CONSTRAINT を使う理由 (0011 ステップ 9b と同じ):
--   DROP + ADD だと FK 制約の再検証 (全行スキャン) と参照先 auth.users への
--   ロック取得が発生する。RENAME CONSTRAINT はカタログのみの変更で済む。
-- ============================================================================

SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint

ALTER TABLE "public"."favorites"
  RENAME CONSTRAINT "favorites_user_id_auth_users_fk"
                 TO "favorites_auth_user_id_auth_users_fk";
