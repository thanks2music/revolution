-- 0023: 写真ごとの非公開 (one-more-time #164)
--
-- AI の審査で 1 枚だけ問題があった時に、口コミは公開してその写真だけを出さない。理由は本人にだけ
-- マイページで見せる (列は本人の SELECT で読める。公開の読み出しは非公開の写真を出さない: #3 は次の PR)。
-- 書くのは審査とサーバー (service role) だけ。authenticated には UPDATE の GRANT が sort_order しか無い (0015)。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "public"."review_images" ADD COLUMN "hidden_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "public"."review_images" ADD COLUMN "hidden_reason_code" text;
--> statement-breakpoint
ALTER TABLE "public"."review_images" ADD CONSTRAINT "review_images_hidden_reason_chk"
  CHECK ("hidden_reason_code" IS NULL OR "hidden_reason_code" IN ('personal_info', 'abuse', 'spam', 'resale'));
--> statement-breakpoint
ALTER TABLE "public"."review_images" ADD CONSTRAINT "review_images_hidden_pair_chk"
  CHECK (("hidden_at" IS NULL) = ("hidden_reason_code" IS NULL));
--> statement-breakpoint

-- 審査の結果を 1 つのトランザクションで書く (口コミの状態と、写真ごとの非公開の印)。
-- 読んだ時の submitted_at と「審査中」を条件にし、合わなければ何も書かずに 'superseded' を返す。印を状態と
-- 別に書くと、古い本文の審査の印が、新しい提出の審査の後に書かれうるため (2026-11-23 のセキュリティのレビュー)。
-- p_photo_ids は審査した写真の ID。今の写真の集まりと違えば (審査の間に写真が足された・外された)、何も書かずに
-- 'photos_changed' を返す (見ていない写真を公開しないため。呼んだ側が読み直して審査し直す)。書けたら 'applied'。
-- p_photo_marks は [{"id": 写真の ID, "hide": 真偽, "reason": 理由のコードか null}]。null なら印に触らない。
-- 呼ぶのはサーバー (service role) だけ。
CREATE OR REPLACE FUNCTION public.apply_review_screening(
  p_review_id bigint,
  p_submitted_at timestamptz,
  p_status text,
  p_reason_code text,
  p_ai_reason text,
  p_ai_error text,
  p_ai_model text,
  p_screened_at timestamptz,
  p_photo_ids bigint[],
  p_photo_marks jsonb
)
RETURNS text
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  -- 口コミの行を押さえてから、写真の集まりを比べる (比べた後に写真が足されないように)
  PERFORM 1 FROM "public"."reviews" WHERE "id" = p_review_id FOR UPDATE;
  IF (
    SELECT coalesce(array_agg("id" ORDER BY "id"), '{}')
    FROM "public"."review_images" WHERE "review_id" = p_review_id
  ) IS DISTINCT FROM (
    SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p_photo_ids) AS x
  ) THEN
    RETURN 'photos_changed';
  END IF;

  UPDATE "public"."reviews"
  SET "status" = p_status,
      "reason_code" = p_reason_code,
      "ai_reason" = p_ai_reason,
      "ai_error" = p_ai_error,
      "ai_model" = p_ai_model,
      "ai_screened_at" = p_screened_at
  WHERE "id" = p_review_id
    AND "status" = 'pending'
    AND "submitted_at" = p_submitted_at
    AND "deleted_at" IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN 'superseded';
  END IF;

  IF p_photo_marks IS NOT NULL THEN
    UPDATE "public"."review_images" AS i
    SET "hidden_at" = CASE WHEN m."hide" THEN p_screened_at END,
        "hidden_reason_code" = CASE WHEN m."hide" THEN m."reason" END
    FROM jsonb_to_recordset(p_photo_marks) AS m("id" bigint, "hide" boolean, "reason" text)
    WHERE i."id" = m."id" AND i."review_id" = p_review_id;
  END IF;
  RETURN 'applied';
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.apply_review_screening(bigint, timestamptz, text, text, text, text, text, timestamptz, bigint[], jsonb) FROM public, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.apply_review_screening(bigint, timestamptz, text, text, text, text, text, timestamptz, bigint[], jsonb) TO service_role;
