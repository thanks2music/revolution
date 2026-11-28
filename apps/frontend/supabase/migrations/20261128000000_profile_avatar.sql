-- 0031: プロフィール画像 (one-more-time #171)
--
-- profiles に画像のキー・状態 (審査中 / 公開 / 落ちた / 外した)・落ちた理由・BOSS が外した日時を足す。
-- 書くのはサーバー (service role) だけ。会員の UPDATE は今のまま display_name と username だけ
-- (本人は画像の状態と理由を書けない)。他人に見せるのは、公開の時だけ値が入る生成列 avatar_public_key だけ
-- (状態や落ちた理由を見せると、誰の画像が落ちたかが分かるため)。BOSS が外した会員は画像を持てない (CHECK)。
-- 退会のトリガは、画像のキー・状態・理由も空にする (保管側と配信側の物は、退会の処理がアプリで消す)。
-- 上げる署名付き URL の記録 profile_avatar_uploads は、口コミの写真の review_photo_uploads (0022) と同じ作り
-- (1 人 1 日に取り込んでいない URL は 10 まで)。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE "profile_avatar_uploads" (
	"image_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_avatar_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_status" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_reason_code" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_public_key" text GENERATED ALWAYS AS (case when avatar_status = 'published' then avatar_key end) STORED;--> statement-breakpoint
ALTER TABLE "profile_avatar_uploads" ADD CONSTRAINT "profile_avatar_uploads_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_avatar_uploads_profile_idx" ON "profile_avatar_uploads" USING btree ("profile_id","created_at");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_status_chk" CHECK ("profiles"."avatar_status" in ('pending', 'published', 'rejected', 'removed'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_reason_chk" CHECK ("profiles"."avatar_reason_code" in ('sexual_or_violent', 'unverifiable'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_key_status_chk" CHECK (("profiles"."avatar_key" is not null) = (coalesce("profiles"."avatar_status", '') in ('pending', 'published')));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_reason_status_chk" CHECK (("profiles"."avatar_reason_code" is not null) = (coalesce("profiles"."avatar_status", '') = 'rejected'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_removed_chk" CHECK ("profiles"."avatar_removed_at" is null or "profiles"."avatar_key" is null);

--> statement-breakpoint
REVOKE ALL ON TABLE "public"."profile_avatar_uploads" FROM anon, authenticated;
--> statement-breakpoint

-- 取り込んでいない URL が 1 日の間に 10 あれば断る (0022 と同じ形。会員の行を押さえてから数える)
CREATE OR REPLACE FUNCTION private.limit_profile_avatar_uploads()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM "public"."profiles" WHERE "id" = NEW."profile_id" FOR UPDATE;
  DELETE FROM "public"."profile_avatar_uploads"
  WHERE "profile_id" = NEW."profile_id" AND "created_at" < now() - interval '1 day';
  IF (
    SELECT count(*) FROM "public"."profile_avatar_uploads"
    WHERE "profile_id" = NEW."profile_id"
  ) >= 10 THEN
    RAISE EXCEPTION 'too many pending profile avatar uploads'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'profile_avatar_uploads_max_pending';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_profile_avatar_uploads_limit"
  BEFORE INSERT ON "public"."profile_avatar_uploads"
  FOR EACH ROW EXECUTE FUNCTION private.limit_profile_avatar_uploads();
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION private.limit_profile_avatar_uploads() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.limit_profile_avatar_uploads() TO service_role;
--> statement-breakpoint

-- 見せるのは公開の画像のキーだけ。状態・理由・外した日時は、本人の画面もサーバー (service role) が読む
GRANT SELECT ("avatar_public_key") ON TABLE "public"."profiles" TO anon, authenticated;
--> statement-breakpoint

-- 退会の匿名化に画像を足す (0011 の関数を置き換える。外した日時は残す: 退会した会員は画像を設定できない)
CREATE OR REPLACE FUNCTION private.handle_user_deleted()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE "public"."profiles"
     SET "withdrawn_at"       = now(),
         "display_name"       = NULL,   -- PII 匿名化
         "username"           = NULL,   -- 公開ハンドルも解放
         "avatar_key"         = NULL,   -- プロフィール画像も空にする (R2 の物はアプリが消す)
         "avatar_status"      = NULL,
         "avatar_reason_code" = NULL
   WHERE "auth_user_id" = OLD."id";
  RETURN OLD;
END;
$$;
