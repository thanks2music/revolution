-- 0022: 写真を上げる署名付き URL を出した記録 (one-more-time #163)
--
-- 署名付き URL を出すたびに 1 行を足し、取り込んだら消す。1 つの口コミについて、期限内 (10 分) の
-- 行が上限 (10) に達していたら、新しい URL を出さない。受け取り場所に上がった物を数えるだけでは、
-- 上げる前に URL をまとめて取れば上限を超えられる (2026-11-22 のセキュリティのレビュー)。
-- 数えて足すのは、口コミの行を FOR UPDATE で押さえたトリガの中で行う (同時に出しても超えない)。
--
-- 取り込みは、この行がある写真だけを受け付ける (サーバーが出した URL の写真だけ)。
-- 読み書きはサーバー (service role) だけ。RLS を有効にし、policy は置かない。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE "public"."review_photo_uploads" (
  "photo_id" uuid PRIMARY KEY NOT NULL,
  "review_id" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_photo_uploads_review_id_reviews_id_fk"
    FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "review_photo_uploads_review_idx" ON "public"."review_photo_uploads" ("review_id", "created_at");
--> statement-breakpoint
ALTER TABLE "public"."review_photo_uploads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."review_photo_uploads" FROM anon, authenticated;
--> statement-breakpoint

-- 期限内の URL が上限に達していたら断る。10 分は署名付き URL の有効期間 (lib/reviews/photos/storage.ts)、
-- 10 は MAX_PENDING_UPLOADS (lib/reviews/photos/operations.ts) と揃える
CREATE OR REPLACE FUNCTION private.limit_review_photo_uploads()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM "public"."reviews" WHERE "id" = NEW."review_id" FOR UPDATE;
  -- 期限を過ぎた行は、この口コミの分だけ片付ける (表が溜まらないように)
  DELETE FROM "public"."review_photo_uploads"
  WHERE "review_id" = NEW."review_id" AND "created_at" < now() - interval '1 day';
  IF (
    SELECT count(*) FROM "public"."review_photo_uploads"
    WHERE "review_id" = NEW."review_id" AND "created_at" > now() - interval '10 minutes'
  ) >= 10 THEN
    RAISE EXCEPTION 'too many pending review photo uploads'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_photo_uploads_max_pending';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_review_photo_uploads_limit"
  BEFORE INSERT ON "public"."review_photo_uploads"
  FOR EACH ROW EXECUTE FUNCTION private.limit_review_photo_uploads();
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION private.limit_review_photo_uploads() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.limit_review_photo_uploads() TO service_role;
