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
-- - 一覧に投稿者名を出すため、公開中の口コミの投稿者の profiles を読めるようにする。判定には
--   profiles に持たせた公開中の口コミの件数 (published_review_count) を使う。profiles の policy から
--   reviews を引くと、reviews の policy (本人の判定で profiles を引く) と互いを呼び合い、
--   `infinite recursion detected in policy` になるため (2026-11-21 に結合テストで実測)

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

-- 前提を守る: 行が残っている環境では止める (既存の行の移行は書いていない。生成列の追加で表も書き直す)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."reviews") THEN
    RAISE EXCEPTION '0018 assumes public.reviews is empty; migrate existing rows first';
  END IF;
END $$;
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

-- 公開中の口コミの件数 (C-2 の policy の判定に使う。集計のトリガ B-3 が増減する)
ALTER TABLE "public"."profiles"
  ADD COLUMN "published_review_count" integer DEFAULT 0 NOT NULL,
  ADD CONSTRAINT "profiles_published_review_count_chk" CHECK ("published_review_count" >= 0);
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
  -- 素通しするのは信頼する役割だけ (審査の結果を書くサーバー・トリガ関数の所有者・管理)。
  -- 「authenticated 以外は通す」にすると、後で足した役割が黙って状態を書けてしまう
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- 内容が変わった時だけ審査中へ戻す。比べるのは「投稿者が書ける列」ではなく、
    -- 状態・日時・生成列を除いた残り全部 (内容の列を足した時に、ここへの書き忘れで審査を
    -- 素通りする穴にならないように)。投稿者は列単位の GRANT で内容の列しか書けないので、
    -- 残りが違えば内容が変わったことになる。visited_month は BEFORE の時点では計算前なので除く
    IF OLD."status" = 'draft'
       OR (to_jsonb(NEW) - ARRAY['updated_at', 'visited_month'])
          IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'visited_month'])
    THEN
      RETURN NEW;
    END IF;
    -- 最終編集日は「公開の後に内容を変えて出し直した」口コミだけに出す
    IF OLD."status" = 'published' THEN
      NEW."edited_at" := now();
    END IF;
  ELSE
    -- 下書きの入口は下書きのチケットで足す。今は提出だけ
    NEW."edited_at" := NULL;
  END IF;

  -- 提出・出し直しは審査中から始める。前の内容への理由と AI の判断は当てはまらないので消す
  NEW."status" := 'pending';
  NEW."submitted_at" := now();
  NEW."reason_code" := NULL;
  NEW."reason_note" := NULL;
  NEW."ai_reason" := NULL;
  NEW."ai_error" := NULL;
  NEW."ai_model" := NULL;
  NEW."ai_screened_at" := NULL;
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
BEGIN
  -- UPDATE OF visited_on は、値が同じでも SET に含まれていれば発火する。変わっていなければ確かめない
  -- (中止になった開催の口コミの本文を直す時に、訪問日を同じ値で送っても拒否しないように)
  IF TG_OP = 'UPDATE' AND NEW."visited_on" IS NOT DISTINCT FROM OLD."visited_on" THEN
    RETURN NEW;
  END IF;

  -- 開催の状態は occurrence_view の判定 (JST) をそのまま使う (状態の決め方を 1 か所に保つ)
  SELECT v."status", v."starts_on", v."ends_on"
    INTO occ
    FROM "public"."occurrence_view" v
   WHERE v."id" = NEW."occurrence_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review occurrence not found' USING ERRCODE = 'check_violation';
  END IF;
  -- 書けるのは開催中か終了した開催だけ (中止・日程未発表・開催前は不可)
  IF occ."status" NOT IN ('ongoing', 'ended') THEN
    RAISE EXCEPTION 'review occurrence is %', occ."status" USING ERRCODE = 'check_violation';
  END IF;

  -- 訪問日は開始日から、終了日と今日の早い方まで (LEAST は NULL を無視するので、終了日が未定なら今日)
  IF NEW."visited_on" IS NOT NULL AND (
       NEW."visited_on" < occ."starts_on"
       OR NEW."visited_on" > LEAST(occ."ends_on", (now() AT TIME ZONE 'Asia/Tokyo')::date)
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
-- あわせて、投稿者の profiles の公開中の口コミの件数も増減する (C-2 の policy が使う)。
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

  IF d_cnt <> 0 THEN
    UPDATE "public"."profiles"
       SET "published_review_count" = "published_review_count" + d_cnt
     WHERE "id" = COALESCE(NEW."user_id", OLD."user_id");
  END IF;

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
-- (1 つの policy にまとめる。同じ役割に許可の policy が重なると Advisor の lint 0006 になるため)
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
    AND (
      "status" = 'published'
      OR "user_id" IN (
        SELECT p."id" FROM "public"."profiles" p
         WHERE p."auth_user_id" = (SELECT auth.uid())
      )
    )
  );
--> statement-breakpoint

-- ⚠️ 投稿者の論理削除 (UPDATE で deleted_at を入れる) は、更新後の行が上の SELECT の policy
-- (deleted_at IS NULL) から外れるため RLS に拒否される (0013 からの挙動、2026-11-21 に確認)。
-- そのため D で deleted_at を投稿者の UPDATE の GRANT から外し、削除はサーバー (service role) が行う。

-- C-2. 一覧に投稿者名を出すため、公開中の口コミの投稿者の profiles を読めるようにする
DROP POLICY "profiles_select_own" ON "public"."profiles";
--> statement-breakpoint
CREATE POLICY "profiles_select_own_or_reviewer"
  ON "public"."profiles"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = "auth_user_id"
    OR "published_review_count" > 0
  );
--> statement-breakpoint
CREATE POLICY "profiles_select_reviewer"
  ON "public"."profiles"
  FOR SELECT
  TO anon
  USING ("published_review_count" > 0);
--> statement-breakpoint
-- 見せる列は表示に要る物だけにする。authenticated も列で絞る (上の policy で他人の行が読めるように
-- なったので、テーブル全体の SELECT のままだと、今後 profiles に足す列が自動で他人に見えてしまう)。
-- authenticated の列は、本人の画面と Server Action が読む物 (id / auth_user_id / username / display_name)
-- と withdrawn_at。updated_at / created_at は読ませない
GRANT SELECT ("id", "display_name", "username", "withdrawn_at") ON TABLE "public"."profiles" TO anon;
--> statement-breakpoint
REVOKE SELECT ON TABLE "public"."profiles" FROM authenticated;
--> statement-breakpoint
GRANT SELECT ("id", "auth_user_id", "display_name", "username", "withdrawn_at")
  ON TABLE "public"."profiles" TO authenticated;
--> statement-breakpoint
-- 書き込みも列で絞る。published_review_count を会員が書き換えると、自分の profile を anon に
-- 見せられてしまう (件数は集計のトリガだけが書く)。会員が書くのは onboarding とマイページの 2 列だけ。
-- INSERT は handle_new_user (SECURITY DEFINER) が行うが、profiles_insert_own の policy に合わせて残す
REVOKE INSERT, UPDATE ON TABLE "public"."profiles" FROM authenticated;
--> statement-breakpoint
GRANT INSERT ("id", "auth_user_id", "display_name", "username") ON TABLE "public"."profiles" TO authenticated;
--> statement-breakpoint
GRANT UPDATE ("display_name", "username") ON TABLE "public"."profiles" TO authenticated;
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
-- deleted_at は含めない: 投稿者が UPDATE で入れると、更新後の行が本人の SELECT の policy
-- (deleted_at IS NULL) から外れて RLS に拒否される。削除はサーバー (service role) が行う
GRANT UPDATE (
  "rating", "body", "visited_on", "attendance", "food_cost_band", "goods_cost_band", "has_spoiler"
) ON TABLE "public"."reviews" TO authenticated;
