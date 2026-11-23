-- 0027: BOSS の操作の関数を締める (one-more-time #167 の ③、revolution #474 のレビューと Figma との照合から)
--
-- - 公開・差し戻しは BOSS の確認待ち (needs_review) だけ。審査中のまま止まった口コミは「もう一度 AI にかける」だけ
--   (仕様 #156 の状態の移り変わり、Figma の「止まっている」の画面)
-- - もう一度 AI にかけられる審査中は、30 分以上止まった物だけ (審査の最中に戻さない)
-- - 公開に空の補足を付けても断らない。補足は 500 字まで。写真の判断は id・hide・reason だけを記録に残す
-- - 一覧の「止まっている」の分数: NULL は 30 分、0 分〜7 日に収める
-- - 審査中の経過は、提出か最後の「もう一度 AI にかける」の遅い方から数える (private.review_pending_since)。
--   提出から数えると、かけ直した直後の口コミが「止まっている」として一覧に残り、続けてかけ直せてしまう。
--   一覧はこの時刻を pending_since として返す (返す列が変わるので、関数を作り直す)
-- - 「止まっている」とみなす分数 (30 分) は private.review_stuck_minutes() の 1 か所だけに置く。一覧の既定・
--   もう一度 AI にかけられる条件・口コミの確認の stuck が同じ値を使う (アプリには持たない)
-- - admin の関数は service role からも呼べなくする (Supabase の既定の付与で入っていた。service role には
--   ログイン中の会員がいないので admin の確認で必ず断られるが、最小権限に合わせる)
-- - 判断の記録の to_status と reason_code に CHECK を足す (口コミの CHECK と同じ値)
--
-- 判断の記録の書き換え・消去を止めるトリガは、API のロール (anon / authenticated / service_role) からの変更を
-- 止める物。表の所有者やスーパーユーザーはトリガを外せる (DB の管理者を信頼する前提)。
--
-- Advisor の Lint 0029 (authenticated_security_definer_function_executable) の admin の関数 4 件は、意図どおり
-- として残す (2026-11-23 BOSS 確定。公式の Option 3)。admin の関数を足す時は、最初に private.assert_admin() を
-- 呼び、anon と public から EXECUTE を外し、authenticated だけに付ける

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 審査中のまま「止まっている」とみなす分数 (仕様 #156)
CREATE OR REPLACE FUNCTION private.review_stuck_minutes()
RETURNS integer
IMMUTABLE
SET search_path = ''
LANGUAGE sql
AS $$ SELECT 30 $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.review_stuck_minutes() FROM public, anon, authenticated, service_role;
--> statement-breakpoint

-- 審査中になった時刻: 提出か、最後の「もう一度 AI にかける」の遅い方 (greatest は NULL を無視する)
CREATE OR REPLACE FUNCTION private.review_pending_since(p_review_id bigint, p_submitted_at timestamptz)
RETURNS timestamptz
STABLE
SET search_path = ''
LANGUAGE sql
AS $$
  SELECT greatest(p_submitted_at, (
    SELECT max(m."created_at") FROM "public"."review_moderation_events" m
    WHERE m."review_id" = p_review_id AND m."action" = 'requeued'
  ));
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.review_pending_since(bigint, timestamptz) FROM public, anon, authenticated, service_role;
--> statement-breakpoint
-- 審査中のまま止まっているか。一覧・もう一度 AI にかける条件・口コミの確認が同じ判定を使う
-- (p_minutes を渡すのは一覧の分数の指定だけ)
CREATE OR REPLACE FUNCTION private.review_is_stuck(
  p_review_id bigint,
  p_submitted_at timestamptz,
  p_status text,
  p_minutes integer DEFAULT NULL
)
RETURNS boolean
STABLE
SET search_path = ''
LANGUAGE sql
AS $$
  SELECT p_status = 'pending'
    AND private.review_pending_since(p_review_id, p_submitted_at)
        < now() - make_interval(mins => coalesce(p_minutes, private.review_stuck_minutes()));
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.review_is_stuck(bigint, timestamptz, text, integer) FROM public, anon, authenticated, service_role;
--> statement-breakpoint
DROP FUNCTION public.admin_list_review_queue(integer);
--> statement-breakpoint
CREATE FUNCTION public.admin_list_review_queue(p_stuck_minutes integer DEFAULT NULL)
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
  "photo_count" integer,
  "pending_since" timestamptz
)
STABLE
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  -- NULL は既定 (private.review_stuck_minutes)、範囲は 0 分〜7 日 (大きすぎる値で make_interval が溢れないように)
  v_minutes integer := least(greatest(coalesce(p_stuck_minutes, private.review_stuck_minutes()), 0), 10080);
BEGIN
  PERFORM private.assert_admin();
  RETURN QUERY
  SELECT r."id", r."status", r."reason_code", r."ai_reason", r."ai_error", r."submitted_at", r."rating",
         e."name", coalesce(v."name", o."venue_label"),
         coalesce(p."display_name", p."username"),
         (SELECT count(*)::integer FROM "public"."review_images" i WHERE i."review_id" = r."id"),
         private.review_pending_since(r."id", r."submitted_at")
  FROM "public"."reviews" r
  JOIN "public"."occurrences" o ON o."id" = r."occurrence_id"
  JOIN "public"."events" e ON e."id" = o."event_id"
  LEFT JOIN "public"."venues" v ON v."id" = o."venue_id"
  LEFT JOIN "public"."profiles" p ON p."id" = r."user_id"
  WHERE r."deleted_at" IS NULL
    AND (
      r."status" = 'needs_review'
      OR private.review_is_stuck(r."id", r."submitted_at", r."status", v_minutes)
    )
  ORDER BY r."submitted_at" ASC, r."id" ASC;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_decide_review(
  p_review_id bigint,
  p_submitted_at timestamptz,
  p_decision text,
  p_reason_code text,
  p_reason_note text,
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
  v_note text := nullif(btrim(p_reason_note), '');
  v_marks jsonb;
  v_photo_ids bigint[];
  -- 審査の理由 (REVIEW_SCREENING_REASONS と、0023 の hidden_reason_code の CHECK と揃える)
  v_reasons constant text[] := ARRAY['personal_info', 'abuse', 'spam', 'resale'];
BEGIN
  PERFORM private.assert_admin();
  IF p_decision = 'publish' THEN
    v_to := 'published';
    IF p_reason_code IS NOT NULL OR v_note IS NOT NULL THEN
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
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'reason note is too long' USING ERRCODE = '22023';
  END IF;
  -- 写真の判断は 1 枚に 1 つ (重複で結果が揺れないように)。抜けは下の写真の集まりの比較で photos_changed になる
  IF p_photo_marks IS NULL OR jsonb_typeof(p_photo_marks) <> 'array' THEN
    RAISE EXCEPTION 'photo decisions must be an array' USING ERRCODE = '22023';
  END IF;
  -- 記録に残すのは id・hide・reason だけ (記録は消せないので、余計なキーや大きい値を残さない)
  SELECT coalesce(array_agg(m."id"), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', m."id", 'hide', m."hide",
                                               'reason', CASE WHEN m."hide" THEN m."reason" END)), '[]'::jsonb)
    INTO v_photo_ids, v_marks
  FROM jsonb_to_recordset(p_photo_marks) AS m("id" bigint, "hide" boolean, "reason" text);
  IF cardinality(v_photo_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_photo_ids) AS x) THEN
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
    AND r."status" = 'needs_review'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'superseded';
  END IF;
  IF NOT private.review_photo_ids_match(p_review_id, v_photo_ids) THEN
    RETURN 'photos_changed';
  END IF;

  UPDATE "public"."reviews"
  SET "status" = v_to,
      "reason_code" = p_reason_code,
      "reason_note" = v_note
  WHERE "id" = p_review_id;

  UPDATE "public"."review_images" AS i
  SET "hidden_at" = CASE WHEN m."hide" THEN coalesce(i."hidden_at", now()) END,
      "hidden_reason_code" = CASE WHEN m."hide" THEN m."reason" END
  FROM jsonb_to_recordset(v_marks) AS m("id" bigint, "hide" boolean, "reason" text)
  WHERE i."id" = m."id" AND i."review_id" = p_review_id;

  INSERT INTO "public"."review_moderation_events"
    ("review_id", "actor", "actor_user_id", "action", "from_status", "to_status", "reason_code",
     "reason_note", "photo_marks")
  VALUES
    (p_review_id, 'admin', (SELECT auth.uid()), v_to, v_from, v_to, p_reason_code, v_note, v_marks);
  RETURN 'applied';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_requeue_review(p_review_id bigint, p_submitted_at timestamptz)
RETURNS text
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_from text;
BEGIN
  PERFORM private.assert_admin();
  SELECT r."status" INTO v_from FROM "public"."reviews" r
  WHERE r."id" = p_review_id AND r."deleted_at" IS NULL AND r."submitted_at" = p_submitted_at
    AND (
      r."status" = 'needs_review'
      -- 審査中は止まった物だけ (審査の最中に戻すと「審査した」の記録が重なる。一覧の既定と同じ分数)
      OR private.review_is_stuck(r."id", r."submitted_at", r."status")
    )
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
-- 口コミの確認に、審査中になった時刻 (pending_since) と「止まっている」か (stuck) を足す。止まっているかは
-- 一覧ともう一度 AI にかける条件と同じ判定にする (アプリで 30 分を数え直さない)
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
  PERFORM private.assert_admin();
  SELECT jsonb_build_object(
    'review', to_jsonb(r) - 'user_id',
    'pending_since', private.review_pending_since(r."id", r."submitted_at"),
    'stuck', private.review_is_stuck(r."id", r."submitted_at", r."status"),
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
-- 作り直したので、0026 と同じく authenticated だけに付け直す
REVOKE EXECUTE ON FUNCTION public.admin_list_review_queue(integer) FROM public, anon, service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_list_review_queue(integer) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_get_review(bigint) FROM service_role;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_decide_review(bigint, timestamptz, text, text, text, jsonb) FROM service_role;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_requeue_review(bigint, timestamptz) FROM service_role;
--> statement-breakpoint
ALTER TABLE "public"."review_moderation_events"
  ADD CONSTRAINT "review_moderation_events_to_status_chk"
    CHECK ("to_status" IN ('draft', 'pending', 'published', 'rejected', 'needs_review', 'hidden')),
  ADD CONSTRAINT "review_moderation_events_reason_code_chk"
    CHECK ("reason_code" IS NULL OR "reason_code" IN ('personal_info', 'abuse', 'spam', 'resale', 'ai_failure'));
