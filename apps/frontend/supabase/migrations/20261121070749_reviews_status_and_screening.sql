-- 0018: 口コミの状態・審査・投稿の項目 (S4 口コミの最初の一本道)
--
-- 口コミを「提出 → AI の審査 → 公開 / 差し戻し / BOSS の確認待ち」の流れに乗せるための差分。
-- 写真・下書きの入口・通報・管理画面 (admin) の RLS は、それぞれのチケットで足す。
--
-- 前提: 本番と staging の reviews / review_images / review_helpful は 0 件
-- (2026-11-21 に確かめた)。既存の行の移行は考えない。
--
-- ## 誰が何を書けるか
--
-- - 投稿者 (authenticated) は内容の列だけを書ける (列単位の GRANT)。状態・理由・AI の記録・
--   helpful_count は書けない
-- - 投稿者が書くと、トリガが状態を必ず「審査中」にする。INSERT は審査中で始まり、公開・差し戻し・
--   確認待ち・非公開の口コミの内容を変えたら審査中へ戻る。状態を変える関数を投稿者に渡さないので、
--   SECURITY DEFINER の関数を authenticated に開けずに済む (Advisor の lint 0028 / 0029)
-- - 状態・理由・AI の記録は、審査を動かすサーバー (service role) だけが書く
--
-- ## 見せ方
--
-- - 公開の SELECT は「公開かつ論理削除していない」だけ。本人は状態を問わず自分の口コミを読める
-- - 他人には訪問年月だけを見せるため、`visited_on` は anon / authenticated の SELECT から外し、
--   月初の生成列 `visited_month` を読ませる。本人の日付・差し戻しの理由は、サーバーが
--   service role で読んで本人にだけ返す
-- - 一覧に投稿者名を出すため、公開中の口コミの投稿者の profiles を読めるようにする

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- A. 列と制約
-- ───────────────────────────────────────────────
ALTER TABLE "public"."reviews"
  ADD COLUMN "status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN "reason_code" text,
  ADD COLUMN "reason_note" text,
  ADD COLUMN "ai_reason" text,
  ADD COLUMN "ai_error" text,
  ADD COLUMN "ai_model" text,
  ADD COLUMN "ai_screened_at" timestamp with time zone,
  ADD COLUMN "submitted_at" timestamp with time zone,
  ADD COLUMN "edited_at" timestamp with time zone,
  ADD COLUMN "attendance" text,
  ADD COLUMN "food_cost_band" text,
  ADD COLUMN "goods_cost_band" text,
  ADD COLUMN "has_spoiler" boolean DEFAULT false NOT NULL,
  -- 他人に見せる訪問年月 (月初の日付)。date → timestamp の変換と date_trunc は不変なので生成列にできる
  ADD COLUMN "visited_month" date
    GENERATED ALWAYS AS ((date_trunc('month', "visited_on"::timestamp))::date) STORED;
--> statement-breakpoint

-- 下書きは途中まで書けるので、星を空にできるようにする (星と訪問日は下書き以外で必須)
ALTER TABLE "public"."reviews" ALTER COLUMN "rating" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_status_chk" CHECK (
    "status" IN ('draft', 'pending', 'published', 'rejected', 'needs_review', 'hidden')
  ),
  -- 審査の 4 種と AI 審査の失敗。通報の理由は通報のチケットで足す
  ADD CONSTRAINT "reviews_reason_code_chk" CHECK (
    "reason_code" IS NULL
    OR "reason_code" IN ('personal_info', 'abuse', 'spam', 'resale', 'ai_failure')
  ),
  ADD CONSTRAINT "reviews_attendance_chk" CHECK (
    "attendance" IS NULL
    OR "attendance" IN ('walk_in', 'reservation', 'queue', 'lottery', 'other')
  ),
  ADD CONSTRAINT "reviews_food_cost_band_chk" CHECK (
    "food_cost_band" IS NULL
    OR "food_cost_band" IN ('none', 'under_2000', '2000_3000', '3000_5000', 'over_5000')
  ),
  ADD CONSTRAINT "reviews_goods_cost_band_chk" CHECK (
    "goods_cost_band" IS NULL
    OR "goods_cost_band" IN ('none', 'under_5000', '5000_10000', '10000_30000', 'over_30000')
  ),
  ADD CONSTRAINT "reviews_body_length_chk" CHECK ("body" IS NULL OR char_length("body") <= 2000),
  ADD CONSTRAINT "reviews_required_unless_draft_chk" CHECK (
    "status" = 'draft' OR ("rating" IS NOT NULL AND "visited_on" IS NOT NULL)
  );
--> statement-breakpoint

-- 1 人 1 開催 1 件は「論理削除していない行」だけで数える (削除の後に書き直せるように)
DROP INDEX "public"."reviews_occurrence_user_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_occurrence_user_uniq"
  ON "public"."reviews" USING btree ("occurrence_id", "user_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- 開催ページの一覧 (公開中を新着順) と、公開の SELECT の policy の述語に使う
CREATE INDEX "reviews_occurrence_published_idx"
  ON "public"."reviews" USING btree ("occurrence_id", "submitted_at" DESC)
  WHERE "status" = 'published' AND "deleted_at" IS NULL;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B. トリガ
-- ───────────────────────────────────────────────

-- B-1. 投稿者の書き込みでは、状態を審査中にする
--
-- SECURITY INVOKER なので current_user は書き込んだ役割になる (PostgREST は authenticated に切り替える)。
-- service role の書き込み (審査の結果・テストの準備) には手を出さない。
CREATE OR REPLACE FUNCTION private.guard_review_author_write()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 下書きの入口は下書きのチケットで足す。今は提出だけ
    NEW."status" := 'pending';
    NEW."submitted_at" := now();
    NEW."edited_at" := NULL;
    NEW."reason_code" := NULL;
    NEW."reason_note" := NULL;
    NEW."ai_reason" := NULL;
    NEW."ai_error" := NULL;
    NEW."ai_model" := NULL;
    NEW."ai_screened_at" := NULL;
    RETURN NEW;
  END IF;

  -- 内容が変わった時だけ審査中へ戻す (論理削除だけの UPDATE では戻さない)
  IF (NEW."rating", NEW."body", NEW."visited_on", NEW."attendance", NEW."food_cost_band",
      NEW."goods_cost_band", NEW."has_spoiler")
     IS DISTINCT FROM
     (OLD."rating", OLD."body", OLD."visited_on", OLD."attendance", OLD."food_cost_band",
      OLD."goods_cost_band", OLD."has_spoiler")
     AND OLD."status" <> 'draft'
  THEN
    -- 最終編集日は「公開の後に内容を変えて出し直した」口コミだけに出す
    IF OLD."status" = 'published' THEN
      NEW."edited_at" := now();
    END IF;
    NEW."status" := 'pending';
    NEW."submitted_at" := now();
    NEW."reason_code" := NULL;
    NEW."reason_note" := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_reviews_guard_author_write"
  BEFORE INSERT OR UPDATE ON "public"."reviews"
  FOR EACH ROW EXECUTE FUNCTION private.guard_review_author_write();
--> statement-breakpoint

-- B-2. 開催の状態と訪問日の範囲を確かめる
--
-- - 中止・日程未発表・開催前の開催には、下書きも提出もできない
-- - 訪問日は開始日から、終了日と今日の早い方まで (日付は JST)
-- サーバーの検証と二段にする。INSERT と、訪問日を変える UPDATE で確かめる
-- (状態だけを変える審査の結果の書き込みでは確かめない。開催が終わった後も審査は進むため)。
CREATE OR REPLACE FUNCTION private.check_review_occurrence()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  occ record;
  today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  SELECT o."starts_on", o."ends_on", o."cancelled_at"
    INTO occ
    FROM "public"."occurrences" o
   WHERE o."id" = NEW."occurrence_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review occurrence not found' USING ERRCODE = 'check_violation';
  END IF;
  IF occ."cancelled_at" IS NOT NULL THEN
    RAISE EXCEPTION 'review occurrence is cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF occ."starts_on" IS NULL THEN
    RAISE EXCEPTION 'review occurrence is unscheduled' USING ERRCODE = 'check_violation';
  END IF;
  IF today < occ."starts_on" THEN
    RAISE EXCEPTION 'review occurrence has not started' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."visited_on" IS NOT NULL AND (
       NEW."visited_on" < occ."starts_on"
       OR NEW."visited_on" > LEAST(COALESCE(occ."ends_on", today), today)
     ) THEN
    RAISE EXCEPTION 'review visited_on is out of range' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_reviews_check_occurrence"
  BEFORE INSERT OR UPDATE OF "visited_on" ON "public"."reviews"
  FOR EACH ROW EXECUTE FUNCTION private.check_review_occurrence();
--> statement-breakpoint

-- B-3. 星の集計は「公開かつ論理削除していない」だけを数える
--
-- 状態の変化 (公開 ⇄ それ以外) と論理削除の両方で増減する。式は 0013 と同じで、有効の判定だけを変えた。
CREATE OR REPLACE FUNCTION private.apply_review_delta()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  old_sum bigint := 0;
  old_cnt int := 0;
  new_sum bigint := 0;
  new_cnt int := 0;
  d_sum bigint;
  d_cnt int;
  occ bigint;
  ev bigint;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD."deleted_at" IS NULL AND OLD."status" = 'published' AND OLD."rating" IS NOT NULL THEN
    old_sum := OLD."rating";
    old_cnt := 1;
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT')
     AND NEW."deleted_at" IS NULL AND NEW."status" = 'published' AND NEW."rating" IS NOT NULL THEN
    new_sum := NEW."rating";
    new_cnt := 1;
  END IF;

  d_sum := new_sum - old_sum;
  d_cnt := new_cnt - old_cnt;

  IF d_sum = 0 AND d_cnt = 0 THEN
    RETURN NULL;
  END IF;

  occ := COALESCE(NEW."occurrence_id", OLD."occurrence_id");

  UPDATE "public"."occurrences"
     SET "rating_sum" = "rating_sum" + d_sum,
         "rating_count" = "rating_count" + d_cnt
   WHERE "id" = occ
   RETURNING "event_id" INTO ev;

  UPDATE "public"."events"
     SET "rating_sum" = "rating_sum" + d_sum,
         "rating_count" = "rating_count" + d_cnt
   WHERE "id" = ev;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- B-4. 新しい内容の列も updated_at の対象にする
DROP TRIGGER "trg_reviews_updated_at" ON "public"."reviews";
--> statement-breakpoint
CREATE TRIGGER "trg_reviews_updated_at"
  BEFORE UPDATE OF "rating", "body", "visited_on", "deleted_at", "attendance", "food_cost_band",
    "goods_cost_band", "has_spoiler"
  ON "public"."reviews"
  FOR EACH ROW EXECUTE FUNCTION private.set_reviews_updated_at();
--> statement-breakpoint

-- B-5. トリガ関数は直接呼ばせない (0013 と同じ作法)
REVOKE EXECUTE ON FUNCTION private.guard_review_author_write() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guard_review_author_write() TO service_role;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.check_review_occurrence() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.check_review_occurrence() TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- C. RLS
-- ───────────────────────────────────────────────

-- C-1. 口コミの SELECT
-- anon は公開中だけ。authenticated は公開中と、状態を問わない自分の口コミ
-- (1 つの policy にまとめる。同じ役割に許可の policy が重なると Advisor の lint 0006 になるため)。
--
-- ⚠️ 本人の判定は `user_id = auth.uid()` で行い、profiles を引かない。下の C-2 で profiles の
-- policy が reviews を引くので、ここで profiles を引くと policy が互いを呼び合い、
-- `infinite recursion detected in policy` になる (2026-11-21 に結合テストで実測)。
-- profiles.id は handle_new_user が auth のユーザー ID と同じ値で作り、変わらないので、
-- profiles を引いた判定と同じ意味になる (退会すると auth のユーザーが消え、そもそもログインできない)。
DROP POLICY "reviews_select_public" ON "public"."reviews";
--> statement-breakpoint
CREATE POLICY "reviews_select_published"
  ON "public"."reviews"
  FOR SELECT
  TO anon
  USING ("status" = 'published' AND "deleted_at" IS NULL);
--> statement-breakpoint
CREATE POLICY "reviews_select_published_or_own"
  ON "public"."reviews"
  FOR SELECT
  TO authenticated
  USING (
    "deleted_at" IS NULL
    AND ("status" = 'published' OR "user_id" = (SELECT auth.uid()))
  );
--> statement-breakpoint

-- ⚠️ 投稿者の論理削除 (UPDATE で deleted_at を入れる) は、更新後の行が上の SELECT の policy
-- (deleted_at IS NULL) から外れるため RLS に拒否される (0013 からの挙動、2026-11-21 に確認)。
-- 削除の入口は下書き・編集・削除のチケットで、サーバー (service role) から行う形で作る。

-- C-1b. 口コミの INSERT / UPDATE の本人の判定も profiles を引かない形にする (C-1 の ⚠️ と同じ理由。
-- reviews の policy が 1 つでも profiles を引くと、C-2 と輪になる)
DROP POLICY "reviews_insert_self" ON "public"."reviews";
--> statement-breakpoint
CREATE POLICY "reviews_insert_self"
  ON "public"."reviews"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "user_id" = (SELECT auth.uid())
    AND "occurrence_id" IN (SELECT o."id" FROM "public"."occurrences" o WHERE o."verified")
  );
--> statement-breakpoint
DROP POLICY "reviews_update_self" ON "public"."reviews";
--> statement-breakpoint
CREATE POLICY "reviews_update_self"
  ON "public"."reviews"
  FOR UPDATE
  TO authenticated
  USING ("user_id" = (SELECT auth.uid()))
  WITH CHECK (
    "user_id" = (SELECT auth.uid())
    AND "occurrence_id" IN (SELECT o."id" FROM "public"."occurrences" o WHERE o."verified")
  );
--> statement-breakpoint

-- C-2. 一覧に投稿者名を出すため、公開中の口コミの投稿者の profiles を読めるようにする
DROP POLICY "profiles_select_own" ON "public"."profiles";
--> statement-breakpoint
CREATE POLICY "profiles_select_own_or_reviewer"
  ON "public"."profiles"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = "auth_user_id"
    OR "id" IN (
      SELECT r."user_id" FROM "public"."reviews" r
       WHERE r."status" = 'published' AND r."deleted_at" IS NULL
    )
  );
--> statement-breakpoint
CREATE POLICY "profiles_select_reviewer"
  ON "public"."profiles"
  FOR SELECT
  TO anon
  USING (
    "id" IN (
      SELECT r."user_id" FROM "public"."reviews" r
       WHERE r."status" = 'published' AND r."deleted_at" IS NULL
    )
  );
--> statement-breakpoint
-- anon に見せる列は表示に要る物だけ
GRANT SELECT ("id", "display_name", "username", "withdrawn_at") ON TABLE "public"."profiles" TO anon;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- D. 列単位の GRANT
-- ───────────────────────────────────────────────
-- 読み: 訪問日 (日付)・理由・AI の記録は外す。deleted_at は残す (写真・参考になった・profiles の
-- policy の式が見るため。policy の式は呼び出した役割の権限で評価される)
REVOKE SELECT, INSERT, UPDATE ON TABLE "public"."reviews" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (
  "id", "occurrence_id", "user_id", "rating", "body", "visited_month", "attendance",
  "food_cost_band", "goods_cost_band", "has_spoiler", "helpful_count", "status",
  "submitted_at", "edited_at", "created_at", "deleted_at"
) ON TABLE "public"."reviews" TO anon, authenticated;
--> statement-breakpoint
-- 書き: 内容の列だけ (状態・理由・AI の記録・helpful_count は書けない)
GRANT INSERT (
  "occurrence_id", "user_id", "rating", "body", "visited_on", "attendance", "food_cost_band",
  "goods_cost_band", "has_spoiler"
) ON TABLE "public"."reviews" TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
  "rating", "body", "visited_on", "attendance", "food_cost_band", "goods_cost_band",
  "has_spoiler", "deleted_at"
) ON TABLE "public"."reviews" TO authenticated;
