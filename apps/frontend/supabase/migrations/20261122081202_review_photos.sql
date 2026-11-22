-- 0021: 口コミの写真を付ける (one-more-time #163)
--
-- 写真はブラウザから R2 の受け取り場所へ直接上げ、サーバーが取り出して変換し (EXIF を消し、
-- 表示用の数段の大きさの WebP / AVIF にする)、非公開の保管側に置いてから行を足す。
-- この migration は、その行の守りを入れる。写真の公開 (配信側・公開の SELECT) は #164 で足す。
--
-- 前提: 本番と staging の review_images は 0 件 (2026-11-22 に確かめる)。既存の行の移行は考えない。
--
-- ## 誰が何を書けるか
--
-- - 行を足すのはサーバー (service role) だけ。変換して保管側に置いた後に足す。投稿者から INSERT を
--   取り上げる (任意の object_key を指す行を作らせない)
-- - 写真を外すのもサーバーだけ (保管側の物も一緒に消す)。投稿者から DELETE を取り上げる。
--   並び (sort_order) の UPDATE は既存の列単位の GRANT と policy のまま
-- - 1 つの口コミに 10 枚まで。足す時に口コミの行を FOR UPDATE で押さえてから数え、並び (sort_order) を
--   最後に付ける (同時に足しても、超えない・並びが重ならない)
-- - 下書きでない口コミに写真を足したら、口コミを審査中に戻す (写真も審査の対象のため)
--
-- ## 見せ方
--
-- - 写真を読めるのは本人だけにする。今までの review_images_select_public は「論理削除していない
--   口コミの写真」を誰にでも見せており、審査中の口コミの写真も読めた
-- - 写真は非公開の保管側にあり、本人は短時間だけ有効な URL で見る (サーバーが出す)

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ───────────────────────────────────────────────
-- A. 列
-- ───────────────────────────────────────────────

-- 変換後の大きさ (向きを直した後の寸法)。表示の時に寸法を知るため (レイアウトのずれを防ぐ)
ALTER TABLE "public"."review_images"
  ADD COLUMN "width" integer NOT NULL,
  ADD COLUMN "height" integer NOT NULL,
  -- 作った表示用の幅 (小さい写真は大きい段を作らないので、写真ごとに違う)
  ADD COLUMN "variant_widths" smallint[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."review_images"
  ADD CONSTRAINT "review_images_size_chk" CHECK ("width" > 0 AND "height" > 0),
  ADD CONSTRAINT "review_images_variant_widths_chk"
    CHECK (cardinality("variant_widths") > 0 AND 0 < ALL ("variant_widths"));
--> statement-breakpoint

-- 1 つの写真に 1 行。同じ写真の取り込みが 2 回走っても、行は 1 つだけになる (2 つ目は 23505)。
-- 行が 2 つになると、片方を外した時に、もう片方が使う保管側の物まで消えるため
CREATE UNIQUE INDEX "review_images_object_key_unique" ON "public"."review_images" ("object_key");
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B. トリガ
-- ───────────────────────────────────────────────

-- B-1. 1 つの口コミに 10 枚まで。並び (sort_order) は最後に付ける
--
-- 数える・並びを付けるを、口コミの行を押さえた中で行う (同時に足しても、超えない・並びが重ならない)。
-- 10 は shared/schemas/review-photo.ts の MAX_REVIEW_PHOTOS と揃える (単体テストで確かめる)
CREATE OR REPLACE FUNCTION private.limit_review_images()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  -- 同じ口コミへの同時の追加を順に並べる (数えてから足すまでの間に、別の追加が入らないように)。
  -- 消した (論理削除した) 口コミには足さない (変換の間に消された時)
  PERFORM 1 FROM "public"."reviews"
  WHERE "id" = NEW."review_id" AND "deleted_at" IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review images can only be added to a review that is not deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM "public"."review_images" WHERE "review_id" = NEW."review_id") >= 10 THEN
    RAISE EXCEPTION 'a review can have at most 10 images'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_images_max_per_review';
  END IF;
  NEW."sort_order" := coalesce(
    (SELECT max("sort_order") + 1 FROM "public"."review_images" WHERE "review_id" = NEW."review_id"),
    0
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_review_images_limit"
  BEFORE INSERT ON "public"."review_images"
  FOR EACH ROW EXECUTE FUNCTION private.limit_review_images();
--> statement-breakpoint

-- B-2. 下書きでない口コミに写真を足したら、審査中に戻す
--
-- 行を足すのはサーバー (service role) なので、口コミの書き込みを見張るトリガ
-- (guard_review_author_write、20261121070749) は素通りする。ここで、投稿者が内容を変えた時と同じ戻し方を
-- する。消す列は guard_review_author_write と同じ。口コミに審査の列を足したら、両方を直す
-- 星の集計は apply_review_delta が状態の変化を見て直す。
CREATE OR REPLACE FUNCTION private.requeue_review_on_image_insert()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "public"."reviews"
  SET "status" = 'pending',
      "submitted_at" = now(),
      "edited_at" = CASE WHEN "status" = 'published' THEN now() ELSE "edited_at" END,
      "reason_code" = NULL,
      "reason_note" = NULL,
      "ai_reason" = NULL,
      "ai_error" = NULL,
      "ai_model" = NULL,
      "ai_screened_at" = NULL
  WHERE "id" = NEW."review_id"
    AND "status" IN ('published', 'rejected', 'needs_review', 'hidden');
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_review_images_requeue"
  AFTER INSERT ON "public"."review_images"
  FOR EACH ROW EXECUTE FUNCTION private.requeue_review_on_image_insert();
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- C. RLS と GRANT
-- ───────────────────────────────────────────────

DROP POLICY IF EXISTS "review_images_select_public" ON "public"."review_images";
--> statement-breakpoint
DROP POLICY IF EXISTS "review_images_insert_own" ON "public"."review_images";
--> statement-breakpoint
-- 外すのもサーバーだけ (保管側の物も一緒に消すため。会員が行だけを消すと、保管側の物が残る)
DROP POLICY IF EXISTS "review_images_delete_own" ON "public"."review_images";
--> statement-breakpoint

CREATE POLICY "review_images_select_own" ON "public"."review_images"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ("review_id" IN (
    SELECT r."id" FROM "public"."reviews" r
    WHERE r."deleted_at" IS NULL
      AND r."user_id" IN (
        SELECT p."id" FROM "public"."profiles" p WHERE p."auth_user_id" = (SELECT auth.uid())
      )
  ));
--> statement-breakpoint

REVOKE SELECT ON TABLE "public"."review_images" FROM anon;
--> statement-breakpoint
REVOKE INSERT, DELETE ON TABLE "public"."review_images" FROM authenticated;
--> statement-breakpoint

-- トリガ関数は呼ぶ人に開けない (既存の private の関数と同じ作法)。トリガとしての実行には要らない
REVOKE EXECUTE ON FUNCTION private.limit_review_images() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.limit_review_images() TO service_role;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.requeue_review_on_image_insert() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.requeue_review_on_image_insert() TO service_role;
