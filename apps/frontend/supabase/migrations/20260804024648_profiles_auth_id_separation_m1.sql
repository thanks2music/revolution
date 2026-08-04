-- ============================================================================
-- M1 (expand) — profiles の認証 ID / 永続 ID 分離【可逆】
-- ============================================================================
--
-- 目的:
--   現状 profiles.id は auth.users(id) を ON DELETE CASCADE で直接参照しており、
--   退会するとプロフィールごと消える。これでは「退会してもレビューは残す」
--   (event-review-data-model.md §4.5 の永続化思想) が実現できない。
--   auth_user_id を分離し、auth リンクだけが切れて profiles 本体は残る形へ移す。
--
--   加えて S0 タスク 1 で確定した RLS は本移行が終わるまで機能しない。
--   reviews / review_images / review_helpful の書き込み policy は profiles を
--   auth_user_id で引くため、profiles_select_own が id 基準のままだと
--   副問い合わせが 0 行を返し全書き込みが失敗する (ER doc §5-4)。
--   → 本 migration は 0012 (新規 5 テーブル) の前提。
--
-- 可逆性:
--   本 M1 では登録トリガが従来どおり id = NEW.id を入れるため、全 profiles 行の
--   id が auth.users に存在し続ける。よって旧 FK (profiles.id -> auth.users) を
--   再作成でき、ロールバック可能な状態が保たれる。
--   不可逆になるのは 0013 (M2) で id の既定値を gen_random_uuid() にしてから。
--
-- 手順の一次資料: docs/schema/revolution-profiles-migration.md §4-1
-- ロールバック手順: 同 §5-2 (M1 適用後 — 条件付きで戻せる)
--
-- ★ 1 migration ファイル = 1 トランザクション (同 §4-0):
--   supabase db push は 1 ファイルの全 SQL を pgconn.Batch に積み、末尾に Sync を
--   1 回だけ送る。明示 BEGIN がなければ暗黙 COMMIT / ROLLBACK になるため
--   all-or-nothing。よって「途中で新規サインアップが差し込まれる race」は起きない。
-- ============================================================================

-- ステップ 0: ロック待ちの上限を設ける
--
-- ステップ 3 の ADD CONSTRAINT ... REFERENCES auth.users(id) は参照先の
-- auth.users にもロックを取る。一瞬とはいえその間サインアップ・ログインが
-- ブロックされる。さらに悪いのは別の長時間クエリの後ろにロック待ちで並ぶケースで、
-- 待機中は後続の全アクセスがブロックされ、短い DDL が長時間の停止に化ける。
-- lock_timeout があれば待たされた時点で失敗して即ロールバックする。
-- 失敗したら空いている時間に再実行すればよい。
-- (Supabase 公式規則 lock-short-transactions、impact MEDIUM-HIGH)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint

-- ステップ 1: 列追加
ALTER TABLE "public"."profiles"
  ADD COLUMN "auth_user_id" uuid,
  ADD COLUMN "withdrawn_at" timestamp with time zone,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- ステップ 2: backfill (現状 profiles.id = auth.users.id なので同値)
UPDATE "public"."profiles" SET "auth_user_id" = "id";--> statement-breakpoint

-- ステップ 2b: created_at を実値で埋める
-- 既定値 (migration 実行時刻) のままにせず、auth 側の実際の登録日時を移す。
UPDATE "public"."profiles" p
   SET "created_at" = u."created_at"
  FROM "auth"."users" u
 WHERE u."id" = p."id";--> statement-breakpoint

-- ステップ 3: UNIQUE + 新 FK
-- ON DELETE SET NULL: 退会で auth リンクだけが切れ、profiles 本体は残る。
ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");--> statement-breakpoint

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_auth_user_fkey"
  FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;--> statement-breakpoint

-- ステップ 4: 旧 FK を落とす ← 本移行の中核
-- これを落とさない限り auth.users の削除が profiles を CASCADE で消してしまう。
ALTER TABLE "public"."profiles"
  DROP CONSTRAINT "profiles_id_auth_users_fk";--> statement-breakpoint

-- ステップ 5: display_name の NOT NULL を外す (退会時 null 化のため)
ALTER TABLE "public"."profiles"
  ALTER COLUMN "display_name" DROP NOT NULL;--> statement-breakpoint

-- ステップ 6: 登録トリガ更新 (M1 版)
--
-- auth_user_id を埋めつつ、id にも従来どおり NEW.id を入れる。
-- これにより全 profiles 行の id が auth.users に存在し続け、旧 FK を
-- 再作成できる = ロールバック可能。M2 でこの id 指定を外す。
--
-- CREATE OR REPLACE なのでトリガ (on_auth_user_created) と権限
-- (0008 の supabase_auth_admin への EXECUTE) はそのまま効く。
-- トリガを再作成しないこと (権限が落ちる)。
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO "public"."profiles" ("id", "auth_user_id", "display_name", "username")
  VALUES (
    NEW."id",
    NEW."id",
    COALESCE(NEW."raw_user_meta_data" ->> 'full_name', ''),
    NULL
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- ステップ 7: 退会トリガ新設
--
-- BEFORE DELETE にする理由: この時点ではまだ auth_user_id が生きているため
-- WHERE で対象行を特定できる。AFTER だと FK の ON DELETE SET NULL が先に走り、
-- どの profile を匿名化すべきか分からなくなる。
CREATE OR REPLACE FUNCTION private.handle_user_deleted()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE "public"."profiles"
     SET "withdrawn_at"  = now(),
         "display_name"  = NULL,   -- PII 匿名化
         "username"      = NULL    -- 公開ハンドルも解放
   WHERE "auth_user_id" = OLD."id";
  RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "on_auth_user_deleted" ON "auth"."users";--> statement-breakpoint

CREATE TRIGGER "on_auth_user_deleted"
  BEFORE DELETE ON "auth"."users" FOR EACH ROW
  EXECUTE FUNCTION private.handle_user_deleted();--> statement-breakpoint

-- 0007 / 0008 と同じ権限設計。
-- Advisor の 0028/0029_*_security_definer_function_executable を出さないため
-- public から REVOKE し、必要なロールにだけ明示 GRANT する。
REVOKE EXECUTE ON FUNCTION private.handle_user_deleted() FROM public;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION private.handle_user_deleted() TO service_role;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION private.handle_user_deleted() TO supabase_auth_admin;--> statement-breakpoint

-- ステップ 8: profiles の RLS 書き換え ← S0 タスク 1 の RLS を動かす鍵
--
-- 書き換えないと reviews / review_images / review_helpful の書き込み policy が
-- 参照する副問い合わせ (profiles を auth_user_id で引く) が 0 行を返す。
ALTER POLICY "profiles_select_own" ON "public"."profiles"
  USING ((SELECT auth.uid()) = "auth_user_id");--> statement-breakpoint

ALTER POLICY "profiles_insert_own" ON "public"."profiles"
  WITH CHECK ((SELECT auth.uid()) = "auth_user_id");--> statement-breakpoint

ALTER POLICY "profiles_update_own" ON "public"."profiles"
  USING      ((SELECT auth.uid()) = "auth_user_id")
  WITH CHECK ((SELECT auth.uid()) = "auth_user_id");--> statement-breakpoint

-- ステップ 9: favorites の列名変更
--
-- favorites.user_id は profiles.id ではなく auth.users(id) を直接参照している
-- (0001 の favorites_user_id_auth_users_fk)。分離後は別の ID 空間になるため、
-- reviews.user_id (= profiles.id) と同名で別物を指す状態を避ける。
--
-- PostgreSQL は policy 式・制約・インデックスの列参照を attnum (列番号) で
-- 保持するため、RENAME COLUMN には policy / FK / PK / index が自動追随する。
-- ただしアプリ側のコードは追随しないため、本 PR で同時に直している。
ALTER TABLE "public"."favorites" RENAME COLUMN "user_id" TO "auth_user_id";--> statement-breakpoint

-- ステップ 9b: 複合 PK の **制約名** を追随させる
--
-- ★ RENAME COLUMN が自動追随させるのは「列への参照」であって、**制約の名前は
--   変わらない**。放置すると DB 側は favorites_user_id_target_type_target_key_pk の
--   ままで、Drizzle の期待名 (favorites_auth_user_id_...) と食い違い、以後
--   `drizzle-kit generate` が毎回この差分を提案し続ける = 恒久的な drift になる。
--   (この抜けは drizzle-kit の生成結果と突き合わせて発見した)
--
-- drizzle-kit の既定は DROP CONSTRAINT → ADD CONSTRAINT だが、それでは
-- **PK の裏の index を作り直す**ことになる。RENAME CONSTRAINT はカタログのみの
-- 変更で index 再構築を伴わず、PK に紐づく index 名も同時に追随する。
-- 到達する最終状態は同じで、こちらのほうが安全なためこちらを採る。
ALTER TABLE "public"."favorites"
  RENAME CONSTRAINT "favorites_user_id_target_type_target_key_pk"
                 TO "favorites_auth_user_id_target_type_target_key_pk";
