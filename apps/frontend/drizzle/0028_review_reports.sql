-- 0028: 口コミの通報 (one-more-time #168 の ①)
--
-- 閲覧者 (未ログインを含む) が公開中の口コミを 8 つの理由で通報する。通報は AI を通さず、BOSS が管理アプリで
-- 処理する (処理の関数は 0029)。
--
-- - 通報の書き込みは公開サイトのサーバーだけ。anon / authenticated には表も関数も渡さない。サーバーが
--   service role で submit_review_report を呼ぶ (仕様 #156。未ログインの通報を受けるため anon に INSERT を
--   与えると、サーバーを通らない書き込みを止められない)
-- - 同じ人から同じ対象への未処理の通報は 1 件にまとめる。人は、ログイン中の会員なら profiles.id、未ログインなら
--   端末の cookie の乱数 (サーバーが作る)。IP アドレスなど、通報した人を特定する情報は持たない
-- - 対象の種類はプロフィール画像も持つ (画像の 5 つの理由)。画像の通報の画面と処理は #171 で作る
-- - 理由のコード: 通報の 8 つのうち 4 つは審査の 4 種と同じ意味なので同じコード。口コミの理由・判断の記録の
--   理由・写真の非公開の理由の CHECK に、足した 4 つを入れる (BOSS が通報を受けて非公開にする時の理由)
-- - 判断の記録の操作に、通報の処理の 3 つ (hidden / kept / dismissed) を足す

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ───────────────────────────────────────────────
-- A. 理由と操作の CHECK を広げる
-- ───────────────────────────────────────────────

ALTER TABLE "public"."reviews" DROP CONSTRAINT "reviews_reason_code_chk";
--> statement-breakpoint
ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_reason_code_chk"
    CHECK ("reason_code" IS NULL OR "reason_code" IN ('personal_info', 'abuse', 'spam', 'resale', 'spoiler_unmarked', 'photo_reposted', 'not_attended', 'other', 'ai_failure'));
--> statement-breakpoint
ALTER TABLE "public"."review_images" DROP CONSTRAINT "review_images_hidden_reason_chk";
--> statement-breakpoint
ALTER TABLE "public"."review_images"
  ADD CONSTRAINT "review_images_hidden_reason_chk"
    CHECK ("hidden_reason_code" IS NULL OR "hidden_reason_code" IN ('personal_info', 'abuse', 'spam', 'resale', 'spoiler_unmarked', 'photo_reposted', 'not_attended', 'other'));
--> statement-breakpoint
ALTER TABLE "public"."review_moderation_events" DROP CONSTRAINT "review_moderation_events_reason_code_chk";
--> statement-breakpoint
ALTER TABLE "public"."review_moderation_events" DROP CONSTRAINT "review_moderation_events_action_chk";
--> statement-breakpoint
ALTER TABLE "public"."review_moderation_events"
  ADD CONSTRAINT "review_moderation_events_reason_code_chk"
    CHECK ("reason_code" IS NULL OR "reason_code" IN ('personal_info', 'abuse', 'spam', 'resale', 'spoiler_unmarked', 'photo_reposted', 'not_attended', 'other', 'ai_failure')),
  ADD CONSTRAINT "review_moderation_events_action_chk"
    CHECK ("action" IN ('screened', 'published', 'rejected', 'requeued', 'hidden', 'kept', 'dismissed'));
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B. 通報
-- ───────────────────────────────────────────────

CREATE TABLE "public"."review_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target_type" text NOT NULL,
	"review_id" bigint,
	"target_profile_id" uuid,
	"reason_code" text NOT NULL,
	"reporter_profile_id" uuid,
	"reporter_device_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"actions" text[],
	"handled_at" timestamp with time zone,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_reports_target_type_chk" CHECK ("target_type" IN ('review', 'profile_image')),
	CONSTRAINT "review_reports_target_chk" CHECK (
		("target_type" = 'review' AND "review_id" IS NOT NULL AND "target_profile_id" IS NULL)
		OR ("target_type" = 'profile_image' AND "target_profile_id" IS NOT NULL AND "review_id" IS NULL)
	),
	CONSTRAINT "review_reports_reason_code_chk" CHECK (
		("target_type" = 'review' AND "reason_code" IN ('personal_info', 'abuse', 'spam', 'resale', 'spoiler_unmarked', 'photo_reposted', 'not_attended', 'other'))
		OR ("target_type" = 'profile_image' AND "reason_code" IN ('personal_info', 'abuse', 'spam', 'photo_reposted', 'other'))
	),
	-- 通報した人は会員か端末のどちらか一方 (両方は入らない)。会員が退会すると reporter_profile_id は null になり、
	-- 通報そのものは残る (誰が通報したかは処理に使わない)。受け付ける時の「どちらか一方が必ずある」は関数が確かめる
	CONSTRAINT "review_reports_reporter_chk" CHECK ("reporter_profile_id" IS NULL OR "reporter_device_id" IS NULL),
	CONSTRAINT "review_reports_status_chk" CHECK ("status" IN ('open', 'handled')),
	CONSTRAINT "review_reports_actions_chk" CHECK (
		"actions" IS NULL
		OR (cardinality("actions") > 0 AND "actions" <@ ARRAY['hidden', 'spoiler_marked', 'photo_hidden', 'image_removed', 'dismissed']::text[])
	),
	CONSTRAINT "review_reports_handled_chk" CHECK (
		("status" = 'open' AND "actions" IS NULL AND "handled_at" IS NULL AND "handled_by" IS NULL)
		OR ("status" = 'handled' AND "actions" IS NOT NULL AND "handled_at" IS NOT NULL AND "handled_by" IS NOT NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "public"."review_reports"
  ADD CONSTRAINT "review_reports_review_id_reviews_id_fk"
    FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public"."review_reports"
  ADD CONSTRAINT "review_reports_target_profile_id_profiles_id_fk"
    FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- 通報した会員が退会しても、通報は残す
ALTER TABLE "public"."review_reports"
  ADD CONSTRAINT "review_reports_reporter_profile_id_profiles_id_fk"
    FOREIGN KEY ("reporter_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- 同じ人から同じ対象への未処理の通報は 1 件 (仕様 #156)
CREATE UNIQUE INDEX "review_reports_open_review_member_uniq"
  ON "public"."review_reports" ("review_id", "reporter_profile_id")
  WHERE "status" = 'open' AND "target_type" = 'review' AND "reporter_profile_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_open_review_device_uniq"
  ON "public"."review_reports" ("review_id", "reporter_device_id")
  WHERE "status" = 'open' AND "target_type" = 'review' AND "reporter_device_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_open_image_member_uniq"
  ON "public"."review_reports" ("target_profile_id", "reporter_profile_id")
  WHERE "status" = 'open' AND "target_type" = 'profile_image' AND "reporter_profile_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_open_image_device_uniq"
  ON "public"."review_reports" ("target_profile_id", "reporter_device_id")
  WHERE "status" = 'open' AND "target_type" = 'profile_image' AND "reporter_device_id" IS NOT NULL;
--> statement-breakpoint
-- 外部キーの索引 (Advisor の unindexed_foreign_keys。上の部分 unique は条件付きなので外部キーの索引にならない)
CREATE INDEX "review_reports_review_idx" ON "public"."review_reports" ("review_id");
--> statement-breakpoint
CREATE INDEX "review_reports_reporter_profile_idx" ON "public"."review_reports" ("reporter_profile_id");
--> statement-breakpoint
CREATE INDEX "review_reports_target_profile_idx" ON "public"."review_reports" ("target_profile_id");
--> statement-breakpoint

-- 読み書きは関数だけ (RLS を有効にし、policy は置かない)
ALTER TABLE "public"."review_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."review_reports" FROM anon, authenticated, service_role;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE "public"."review_reports_id_seq" FROM anon, authenticated, service_role;
--> statement-breakpoint

-- 口コミを通報する。公開サイトのサーバーが service role で呼ぶ。
-- 受けるのは公開中で消されていない口コミだけで、本人の口コミは受けない。同じ人の未処理の通報が既にあれば
-- 何もしない (結果は同じ accepted。重複を閲覧者に知らせる必要はない)
CREATE OR REPLACE FUNCTION public.submit_review_report(
  p_review_id bigint,
  p_reason_code text,
  p_reporter_profile_id uuid,
  p_reporter_device_id uuid
)
RETURNS text
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF (p_reporter_profile_id IS NULL) = (p_reporter_device_id IS NULL) THEN
    RAISE EXCEPTION 'reporter must be a member or a device' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE id = p_review_id
      AND status = 'published'
      AND deleted_at IS NULL
      AND user_id IS DISTINCT FROM p_reporter_profile_id
  ) THEN
    RETURN 'not_found';
  END IF;

  INSERT INTO public.review_reports (target_type, review_id, reason_code, reporter_profile_id, reporter_device_id)
  VALUES ('review', p_review_id, p_reason_code, p_reporter_profile_id, p_reporter_device_id)
  ON CONFLICT DO NOTHING;

  RETURN 'accepted';
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.submit_review_report(bigint, text, uuid, uuid) FROM public, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_review_report(bigint, text, uuid, uuid) TO service_role;
