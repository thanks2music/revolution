-- 0029: BOSS の通報の処理 (one-more-time #168 の ②)
--
-- 管理アプリの通報の一覧から、BOSS が通報された口コミを処理する (Figma 16 / 16-PC)。
-- - 非公開にする (hide): 理由 (通報の 8 つ) とひとことを付けて hidden にする。投稿者はマイページで理由を見て、
--   直して出し直すと審査中に戻る (0018 のトリガ)
-- - 公開のままにする (keep): ネタバレの印と写真ごとの非公開を当てて、公開のまま閉じる。何も変えなければ「問題なし」
-- - 閉じるのは、BOSS が画面で見た通報 (p_report_ids) だけ。見た後に来た通報は未処理のまま残る
-- - 読んだ後に投稿者が出し直した (submitted_at が違う) なら superseded、写真の組が変わったら photos_changed
-- - 公開でなくなった口コミ (編集されて審査中など) は、変えずに「問題なし」で閉じることだけを受ける
--
-- あわせて、確認待ちの判断 (admin_decide_review) の写真の理由を通報の 8 つに広げ、口コミの確認
-- (admin_get_review) が未処理の通報を返すようにする。
--
-- admin の関数の作法は 0027 のとおり: 最初に private.assert_admin()、anon・public・service_role から EXECUTE を
-- 外し、authenticated だけに付ける (Advisor の Lint 0029 は意図どおりとして残す。2026-11-23 BOSS 確定)

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
  -- 差し戻しの理由は審査の 4 種 (REVIEW_SCREENING_REASONS)
  v_reasons constant text[] := ARRAY['personal_info', 'abuse', 'spam', 'resale'];
  -- 写真の非公開の理由は通報の 8 つ (REVIEW_REPORT_REASONS、review_images_hidden_reason_chk と揃える)。
  -- 通報で非公開にした写真が、出し直しの後に確認待ちへ来ても、その理由のまま判断できるように (0029)
  v_photo_reasons constant text[] := ARRAY['personal_info', 'abuse', 'spam', 'resale', 'spoiler_unmarked', 'photo_reposted', 'not_attended', 'other'];
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
    WHERE m."hide" IS NULL OR (m."hide" AND NOT (coalesce(m."reason", '') = ANY (v_photo_reasons)))
  ) THEN
    RAISE EXCEPTION 'a hidden photo needs one of the report reasons' USING ERRCODE = '22023';
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
-- 未処理の通報を返す (0029)。返す値を足すだけなので、作り直さずに置き換える
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
    -- 未処理の通報 (0029)。通報した人は返さない
    'open_reports', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', rr."id", 'reason_code', rr."reason_code", 'created_at', rr."created_at")
                       ORDER BY rr."created_at", rr."id")
      FROM "public"."review_reports" rr WHERE rr."review_id" = r."id" AND rr."status" = 'open'
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
-- 通報の一覧: 未処理の通報がある口コミごと (最初の通報が古い順)。理由ごとの件数を返す。通報した人は返さない
CREATE FUNCTION public.admin_list_review_reports()
RETURNS TABLE (
  "review_id" bigint,
  "status" text,
  "submitted_at" timestamptz,
  "rating" smallint,
  "body" text,
  "has_spoiler" boolean,
  "event_name" text,
  "venue_name" text,
  "author_name" text,
  "photo_count" integer,
  "report_count" integer,
  "first_reported_at" timestamptz,
  "reasons" jsonb
)
STABLE
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM private.assert_admin();
  RETURN QUERY
  WITH open_reports AS (
    SELECT rr."review_id", count(*)::integer AS "report_count", min(rr."created_at") AS "first_reported_at"
    FROM "public"."review_reports" rr
    WHERE rr."status" = 'open' AND rr."target_type" = 'review'
    GROUP BY rr."review_id"
  )
  SELECT r."id", r."status", r."submitted_at", r."rating", r."body", r."has_spoiler",
         e."name", coalesce(v."name", o."venue_label"),
         coalesce(p."display_name", p."username"),
         (SELECT count(*)::integer FROM "public"."review_images" i WHERE i."review_id" = r."id"),
         op."report_count", op."first_reported_at",
         (SELECT jsonb_object_agg(x."reason_code", x."n")
          FROM (SELECT rr."reason_code", count(*) AS "n" FROM "public"."review_reports" rr
                WHERE rr."review_id" = r."id" AND rr."status" = 'open'
                GROUP BY rr."reason_code") x)
  FROM open_reports op
  JOIN "public"."reviews" r ON r."id" = op."review_id"
  JOIN "public"."occurrences" o ON o."id" = r."occurrence_id"
  JOIN "public"."events" e ON e."id" = o."event_id"
  LEFT JOIN "public"."venues" v ON v."id" = o."venue_id"
  LEFT JOIN "public"."profiles" p ON p."id" = r."user_id"
  WHERE r."deleted_at" IS NULL
  ORDER BY op."first_reported_at" ASC, r."id" ASC;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.admin_handle_review_reports(
  p_review_id bigint,
  p_submitted_at timestamptz,
  p_report_ids bigint[],
  p_outcome text,
  p_reason_code text,
  p_reason_note text,
  p_has_spoiler boolean,
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
  v_spoiler boolean;
  v_note text := nullif(btrim(p_reason_note), '');
  v_marks jsonb;
  v_photo_ids bigint[];
  v_spoiler_changed boolean;
  v_photos_changed boolean;
  v_actions text[] := '{}';
  v_action text;
  -- 通報の 8 つ (REVIEW_REPORT_REASONS)。非公開の理由と、写真の非公開の理由に使う
  v_reasons constant text[] := ARRAY['personal_info', 'abuse', 'spam', 'resale', 'spoiler_unmarked', 'photo_reposted', 'not_attended', 'other'];
BEGIN
  PERFORM private.assert_admin();
  IF p_outcome = 'hide' THEN
    IF p_reason_code IS NULL OR NOT (p_reason_code = ANY (v_reasons)) THEN
      RAISE EXCEPTION 'hide needs one of the report reasons' USING ERRCODE = '22023';
    END IF;
  ELSIF p_outcome = 'keep' THEN
    IF p_reason_code IS NOT NULL OR v_note IS NOT NULL THEN
      RAISE EXCEPTION 'keep takes no reason' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown outcome' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'reason note is too long' USING ERRCODE = '22023';
  END IF;
  IF p_has_spoiler IS NULL OR p_report_ids IS NULL THEN
    RAISE EXCEPTION 'spoiler mark and report ids are required' USING ERRCODE = '22023';
  END IF;
  -- 写真の判断の検査と記録の形は admin_decide_review と同じ (1 枚に 1 つ、id・hide・reason だけ)
  IF p_photo_marks IS NULL OR jsonb_typeof(p_photo_marks) <> 'array' THEN
    RAISE EXCEPTION 'photo decisions must be an array' USING ERRCODE = '22023';
  END IF;
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
    RAISE EXCEPTION 'a hidden photo needs one of the report reasons' USING ERRCODE = '22023';
  END IF;

  SELECT r."status", r."has_spoiler" INTO v_from, v_spoiler FROM "public"."reviews" r
  WHERE r."id" = p_review_id AND r."deleted_at" IS NULL AND r."submitted_at" = p_submitted_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'superseded';
  END IF;
  IF NOT private.review_photo_ids_match(p_review_id, v_photo_ids) THEN
    RETURN 'photos_changed';
  END IF;

  v_spoiler_changed := p_has_spoiler IS DISTINCT FROM v_spoiler;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_marks) AS m("id" bigint, "hide" boolean, "reason" text)
    JOIN "public"."review_images" i ON i."id" = m."id" AND i."review_id" = p_review_id
    WHERE m."hide" <> (i."hidden_at" IS NOT NULL) OR (m."hide" AND m."reason" IS DISTINCT FROM i."hidden_reason_code")
  ) INTO v_photos_changed;

  -- 公開でなくなった口コミは、変えずに閉じる (「問題なし」) だけ。公開中でない物を非公開にしたり直したりしない
  IF v_from <> 'published' AND (p_outcome = 'hide' OR v_spoiler_changed OR v_photos_changed) THEN
    RETURN 'not_published';
  END IF;

  IF v_spoiler_changed THEN
    UPDATE "public"."reviews" SET "has_spoiler" = p_has_spoiler WHERE "id" = p_review_id;
    v_actions := v_actions || 'spoiler_marked'::text;
  END IF;
  IF v_photos_changed THEN
    UPDATE "public"."review_images" AS i
    SET "hidden_at" = CASE WHEN m."hide" THEN coalesce(i."hidden_at", now()) END,
        "hidden_reason_code" = CASE WHEN m."hide" THEN m."reason" END
    FROM jsonb_to_recordset(v_marks) AS m("id" bigint, "hide" boolean, "reason" text)
    WHERE i."id" = m."id" AND i."review_id" = p_review_id;
    v_actions := v_actions || 'photo_hidden'::text;
  END IF;

  IF p_outcome = 'hide' THEN
    v_to := 'hidden';
    v_action := 'hidden';
    UPDATE "public"."reviews"
    SET "status" = 'hidden', "reason_code" = p_reason_code, "reason_note" = v_note
    WHERE "id" = p_review_id;
    v_actions := 'hidden'::text || v_actions;
  ELSE
    v_to := v_from;
    IF cardinality(v_actions) = 0 THEN
      v_action := 'dismissed';
      v_actions := ARRAY['dismissed'];
    ELSE
      v_action := 'kept';
    END IF;
  END IF;

  UPDATE "public"."review_reports"
  SET "status" = 'handled', "actions" = v_actions, "handled_at" = now(), "handled_by" = (SELECT auth.uid())
  WHERE "id" = ANY (p_report_ids) AND "review_id" = p_review_id AND "status" = 'open';

  INSERT INTO "public"."review_moderation_events"
    ("review_id", "actor", "actor_user_id", "action", "from_status", "to_status", "reason_code",
     "reason_note", "photo_marks")
  VALUES
    (p_review_id, 'admin', (SELECT auth.uid()), v_action, v_from, v_to, p_reason_code, v_note,
     CASE WHEN v_photos_changed THEN v_marks END);
  RETURN 'applied';
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_list_review_reports() FROM public, anon, service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_list_review_reports() TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.admin_handle_review_reports(bigint, timestamptz, bigint[], text, text, text, boolean, jsonb) FROM public, anon, service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_handle_review_reports(bigint, timestamptz, bigint[], text, text, text, boolean, jsonb) TO authenticated;
