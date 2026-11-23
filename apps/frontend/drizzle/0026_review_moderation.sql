-- 0026: 口コミの審査の記録と、BOSS の操作の関数 (one-more-time #167)
--
-- 管理アプリ (apps/admin、ADR-0006) から BOSS が確認待ちの口コミを処理する。admin かどうかは、ログイン中の
-- 会員の app_metadata.role が 'admin' かで判定する (本人が書き換えられない値。2026-11-23 BOSS 確定)。
--
-- - 管理の読み書きは、admin を確かめる関数 (SECURITY DEFINER) だけを通す。会員のロールに状態・理由・AI の記録の
--   列を GRANT すると、本人の更新の policy と組み合わさって会員が自分の口コミを公開にできてしまうため
--   (2026-11-23 BOSS 確定)。関数の中で admin でなければ 42501 で断る。画面の入口でも確かめる (二段)
-- - 判断の記録 (review_moderation_events) を足す。AI の審査の結果と BOSS の操作ごとに 1 行。書き換えない・消さない。
--   本文の写しは持たない (2026-11-23 BOSS 確定)
-- - R2 への写し・消しと AI の審査のやり直しは、管理アプリのサーバーが admin を確かめた後に service role で行う

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ───────────────────────────────────────────────
-- A. 判断の記録
-- ───────────────────────────────────────────────

CREATE TABLE "public"."review_moderation_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_moderation_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"review_id" bigint NOT NULL,
	"actor" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason_code" text,
	"reason_note" text,
	"ai_model" text,
	"ai_reason" text,
	"ai_error" text,
	"photo_marks" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_moderation_events_actor_chk" CHECK ("review_moderation_events"."actor" IN ('ai', 'admin')),
	CONSTRAINT "review_moderation_events_action_chk" CHECK ("review_moderation_events"."action" IN ('screened', 'published', 'rejected', 'requeued')),
	CONSTRAINT "review_moderation_events_admin_user_chk" CHECK (("review_moderation_events"."actor" = 'admin') = ("review_moderation_events"."actor_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "public"."review_moderation_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "review_moderation_events_review_idx" ON "public"."review_moderation_events" USING btree ("review_id","created_at");
--> statement-breakpoint

-- 読み書きは DB の関数 (SECURITY DEFINER) だけ。会員にも service role にも GRANT しない (service role の鍵で
-- 偽の記録を足せないように)。書き換え・消去は下のトリガが誰であっても止める
REVOKE ALL ON TABLE "public"."review_moderation_events" FROM anon, authenticated, service_role;
--> statement-breakpoint

-- 書き換え・消去を止める (表の所有者が関数から誤って書き換えるのも止める)
CREATE OR REPLACE FUNCTION private.forbid_review_moderation_event_change()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'review_moderation_events is append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trg_review_moderation_events_append_only"
  BEFORE UPDATE OR DELETE ON "public"."review_moderation_events"
  FOR EACH ROW EXECUTE FUNCTION private.forbid_review_moderation_event_change();
--> statement-breakpoint
CREATE TRIGGER "trg_review_moderation_events_no_truncate"
  BEFORE TRUNCATE ON "public"."review_moderation_events"
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_review_moderation_event_change();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.forbid_review_moderation_event_change() FROM public;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B. admin の判定
-- ───────────────────────────────────────────────

-- ログイン中の会員の app_metadata.role が 'admin' か。user_metadata は本人が書き換えられるので見ない。
-- JWT の値ではなく auth.users の今の値を見る (admin の印を外したら、トークンの期限を待たずに止めるため)。
-- 呼ぶのは admin の関数 (SECURITY DEFINER、所有者が auth.users を読める) の中だけ
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
STABLE
SET search_path = ''
LANGUAGE sql
AS $$
  SELECT coalesce((
    SELECT u."raw_app_meta_data" ->> 'role' = 'admin'
    FROM auth.users u
    WHERE u."id" = (SELECT auth.uid())
  ), false)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_admin() FROM public;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- C. AI の審査の書き込みでも記録を残す (0023 の関数に記録を足す。引数と戻り値は変えない)。記録の表に書けるよう
-- SECURITY DEFINER にする (呼べるのは service role だけのまま)
-- ───────────────────────────────────────────────

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
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  -- 口コミの行を押さえ、まだ審査中で読んだ時の提出のままかを先に見る (出し直し・削除なら審査し直さない)。
  -- その後で写真の集まりを比べる (押さえた後なので、比べた後に写真が足されない)
  PERFORM 1 FROM "public"."reviews"
  WHERE "id" = p_review_id AND "status" = 'pending' AND "submitted_at" = p_submitted_at
    AND "deleted_at" IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'superseded';
  END IF;
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

  INSERT INTO "public"."review_moderation_events"
    ("review_id", "actor", "action", "from_status", "to_status", "reason_code", "ai_model", "ai_reason",
     "ai_error", "photo_marks")
  VALUES
    (p_review_id, 'ai', 'screened', 'pending', p_status, p_reason_code, p_ai_model, p_ai_reason, p_ai_error,
     p_photo_marks);
  RETURN 'applied';
END;
$$;
--> statement-breakpoint

-- 写真が変わり続けて審査できなかった時に、AI の審査の失敗として BOSS の確認待ちにする (写真の印は変えない)。
-- 読んだ時の submitted_at と「審査中」を条件にし、合わなければ 'superseded'。呼べるのは service role だけ
CREATE OR REPLACE FUNCTION public.give_up_review_screening(
  p_review_id bigint,
  p_submitted_at timestamptz,
  p_ai_error text,
  p_screened_at timestamptz
)
RETURNS text
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE "public"."reviews"
  SET "status" = 'needs_review',
      "reason_code" = 'ai_failure',
      "ai_reason" = NULL,
      "ai_error" = p_ai_error,
      "ai_model" = NULL,
      "ai_screened_at" = p_screened_at
  WHERE "id" = p_review_id
    AND "status" = 'pending'
    AND "submitted_at" = p_submitted_at
    AND "deleted_at" IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN 'superseded';
  END IF;
  INSERT INTO "public"."review_moderation_events"
    ("review_id", "actor", "action", "from_status", "to_status", "reason_code", "ai_error")
  VALUES
    (p_review_id, 'ai', 'screened', 'pending', 'needs_review', 'ai_failure', p_ai_error);
  RETURN 'applied';
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.give_up_review_screening(bigint, timestamptz, text, timestamptz) FROM public, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.give_up_review_screening(bigint, timestamptz, text, timestamptz) TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- D. BOSS の操作 (管理アプリから、BOSS のログインで呼ぶ)
-- ───────────────────────────────────────────────

-- D-1. 確認待ちの一覧: BOSS の確認待ちと、審査中のまま p_stuck_minutes 分以上の口コミ。古い順
CREATE OR REPLACE FUNCTION public.admin_list_review_queue(p_stuck_minutes integer DEFAULT 30)
RETURNS TABLE (
  "review_id" bigint,
  "status" text,
  "reason_code" text,
  "ai_reason" text,
  "ai_error" text,
  "submitted_at" timestamptz,
  "rating" smallint,
  "event_name" text,
  "venue_name" text,
  "author_name" text,
  "photo_count" integer
)
STABLE
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r."id", r."status", r."reason_code", r."ai_reason", r."ai_error", r."submitted_at", r."rating",
         e."name", coalesce(v."name", o."venue_label"),
         coalesce(p."display_name", p."username"),
         (SELECT count(*)::integer FROM "public"."review_images" i WHERE i."review_id" = r."id")
  FROM "public"."reviews" r
  JOIN "public"."occurrences" o ON o."id" = r."occurrence_id"
  JOIN "public"."events" e ON e."id" = o."event_id"
  LEFT JOIN "public"."venues" v ON v."id" = o."venue_id"
  LEFT JOIN "public"."profiles" p ON p."id" = r."user_id"
  WHERE r."deleted_at" IS NULL
    AND (
      r."status" = 'needs_review'
      OR (r."status" = 'pending'
          AND r."submitted_at" < now() - make_interval(mins => greatest(p_stuck_minutes, 0)))
    )
  ORDER BY r."submitted_at" ASC, r."id" ASC;
END;
$$;
--> statement-breakpoint

-- D-2. 口コミの詳細 (本文・訪問日・理由・AI の記録・写真と非公開の印・判断の記録)。無ければ null
CREATE OR REPLACE FUNCTION public.admin_get_review(p_review_id bigint)
RETURNS jsonb
STABLE
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'review', to_jsonb(r) - 'user_id',
    'event', jsonb_build_object('id', e."id", 'name', e."name", 'slug', e."slug", 'category_slug', c."slug"),
    'occurrence', jsonb_build_object('id', o."id", 'slug', o."slug", 'venue_name', coalesce(v."name", o."venue_label")),
    'author', jsonb_build_object('display_name', p."display_name", 'username', p."username"),
    'photos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i."id", 'object_key', i."object_key", 'width', i."width", 'height', i."height",
        'variant_widths', i."variant_widths", 'sort_order', i."sort_order",
        'hidden_reason_code', i."hidden_reason_code"
      ) ORDER BY i."sort_order", i."id")
      FROM "public"."review_images" i WHERE i."review_id" = r."id"
    ), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m."created_at", m."id")
      FROM "public"."review_moderation_events" m WHERE m."review_id" = r."id"
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM "public"."reviews" r
  JOIN "public"."occurrences" o ON o."id" = r."occurrence_id"
  JOIN "public"."events" e ON e."id" = o."event_id"
  JOIN "public"."categories" c ON c."id" = e."primary_category_id"
  LEFT JOIN "public"."venues" v ON v."id" = o."venue_id"
  LEFT JOIN "public"."profiles" p ON p."id" = r."user_id"
  WHERE r."id" = p_review_id AND r."deleted_at" IS NULL;
  RETURN v_result;
END;
$$;
--> statement-breakpoint

-- D-3. 公開か差し戻し。読んだ時の submitted_at と、確認待ちか審査中であることを条件に書く (その間に投稿者が
-- 出し直していたら 'superseded')。写真の集まりが読んだ時と違えば 'photos_changed' (見ていない写真を公開しない)。
-- p_photo_marks は [{"id", "hide", "reason"}] で、読んだ写真の全部の印を書き直す (抜けと重複は断る)。差し戻しの理由は審査の 4 種だけ
CREATE OR REPLACE FUNCTION public.admin_decide_review(
  p_review_id bigint,
  p_submitted_at timestamptz,
  p_decision text,
  p_reason_code text,
  p_reason_note text,
  p_photo_ids bigint[],
  p_photo_marks jsonb
)
RETURNS text
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_from text;
  v_to text;
  v_reasons constant text[] := ARRAY['personal_info', 'abuse', 'spam', 'resale'];
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_decision = 'publish' THEN
    v_to := 'published';
    IF p_reason_code IS NOT NULL OR p_reason_note IS NOT NULL THEN
      RAISE EXCEPTION 'publish takes no reason' USING ERRCODE = '22023';
    END IF;
  ELSIF p_decision = 'reject' THEN
    v_to := 'rejected';
    IF p_reason_code IS NULL OR NOT (p_reason_code = ANY (v_reasons)) THEN
      RAISE EXCEPTION 'reject needs one of the screening reasons' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown decision' USING ERRCODE = '22023';
  END IF;
  -- 写真の判断は、読んだ写真の全部にちょうど 1 つずつ (抜けた写真に前の印が残らない・重複で結果が揺れないように)
  IF p_photo_marks IS NULL OR jsonb_typeof(p_photo_marks) <> 'array' OR (
    SELECT coalesce(array_agg(m."id" ORDER BY m."id"), '{}')
    FROM jsonb_to_recordset(p_photo_marks) AS m("id" bigint)
  ) IS DISTINCT FROM (
    SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p_photo_ids) AS x
  ) OR (SELECT count(DISTINCT x) FROM unnest(p_photo_ids) AS x) <> coalesce(cardinality(p_photo_ids), 0) THEN
    RAISE EXCEPTION 'photo decisions must cover each photo once' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_photo_marks) AS m("id" bigint, "hide" boolean, "reason" text)
    WHERE m."hide" IS NULL OR (m."hide" AND NOT (coalesce(m."reason", '') = ANY (v_reasons)))
  ) THEN
    RAISE EXCEPTION 'a hidden photo needs one of the screening reasons' USING ERRCODE = '22023';
  END IF;

  SELECT r."status" INTO v_from FROM "public"."reviews" r
  WHERE r."id" = p_review_id AND r."deleted_at" IS NULL AND r."submitted_at" = p_submitted_at
    AND r."status" IN ('needs_review', 'pending')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'superseded';
  END IF;
  IF (
    SELECT coalesce(array_agg("id" ORDER BY "id"), '{}')
    FROM "public"."review_images" WHERE "review_id" = p_review_id
  ) IS DISTINCT FROM (
    SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p_photo_ids) AS x
  ) THEN
    RETURN 'photos_changed';
  END IF;

  UPDATE "public"."reviews"
  SET "status" = v_to,
      "reason_code" = p_reason_code,
      "reason_note" = nullif(btrim(p_reason_note), '')
  WHERE "id" = p_review_id;

  UPDATE "public"."review_images" AS i
  SET "hidden_at" = CASE WHEN m."hide" THEN coalesce(i."hidden_at", now()) END,
      "hidden_reason_code" = CASE WHEN m."hide" THEN m."reason" END
  FROM jsonb_to_recordset(p_photo_marks) AS m("id" bigint, "hide" boolean, "reason" text)
  WHERE i."id" = m."id" AND i."review_id" = p_review_id;

  INSERT INTO "public"."review_moderation_events"
    ("review_id", "actor", "actor_user_id", "action", "from_status", "to_status", "reason_code",
     "reason_note", "photo_marks")
  VALUES
    (p_review_id, 'admin', (SELECT auth.uid()), CASE WHEN v_to = 'published' THEN 'published' ELSE 'rejected' END,
     v_from, v_to, p_reason_code, nullif(btrim(p_reason_note), ''), p_photo_marks);
  RETURN 'applied';
END;
$$;
--> statement-breakpoint

-- D-4. もう一度 AI にかける: 確認待ちか審査中の口コミを審査中に戻す (AI の記録と理由は消す。前の判断は記録に残る)。
-- submitted_at は変えない (呼んだ側がこの後に審査を走らせ、審査はこの値を条件に書く)
CREATE OR REPLACE FUNCTION public.admin_requeue_review(p_review_id bigint, p_submitted_at timestamptz)
RETURNS text
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_from text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  SELECT r."status" INTO v_from FROM "public"."reviews" r
  WHERE r."id" = p_review_id AND r."deleted_at" IS NULL AND r."submitted_at" = p_submitted_at
    AND r."status" IN ('needs_review', 'pending')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'superseded';
  END IF;

  UPDATE "public"."reviews"
  SET "status" = 'pending',
      "reason_code" = NULL,
      "reason_note" = NULL,
      "ai_reason" = NULL,
      "ai_error" = NULL,
      "ai_model" = NULL,
      "ai_screened_at" = NULL
  WHERE "id" = p_review_id;

  INSERT INTO "public"."review_moderation_events"
    ("review_id", "actor", "actor_user_id", "action", "from_status", "to_status")
  VALUES
    (p_review_id, 'admin', (SELECT auth.uid()), 'requeued', v_from, 'pending');
  RETURN 'applied';
END;
$$;
--> statement-breakpoint

-- 呼べるのはログインした会員だけ (中で admin を確かめる)。anon と public には開けない
REVOKE EXECUTE ON FUNCTION public.admin_list_review_queue(integer) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_list_review_queue(integer) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_get_review(bigint) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_get_review(bigint) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_decide_review(bigint, timestamptz, text, text, text, bigint[], jsonb) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_decide_review(bigint, timestamptz, text, text, text, bigint[], jsonb) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_requeue_review(bigint, timestamptz) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_requeue_review(bigint, timestamptz) TO authenticated;
