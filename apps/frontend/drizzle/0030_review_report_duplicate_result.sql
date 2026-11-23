-- 0030: 通報を受けた結果を、新しく入った (accepted) と重なった (duplicate) で分ける (one-more-time #169)
--
-- Slack の要対応には、新しく入った通報だけを知らせる (2026-11-24 BOSS 確定)。同じ人の未処理の通報が既にある時は
-- 何も足さず duplicate を返す。公開サイトは、どちらも閲覧者には「受け付けました」と見せる。
-- 引数・権限 (service_role だけ) は 0028 のまま。返す値が 1 つ増えるだけなので、作り直さずに置き換える

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
DECLARE
  v_inserted integer;
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
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 同じ人の未処理の通報が既にあれば duplicate (閲覧者には受け付けたと見せ、Slack には知らせない)
  RETURN CASE WHEN v_inserted = 1 THEN 'accepted' ELSE 'duplicate' END;
END;
$$;
