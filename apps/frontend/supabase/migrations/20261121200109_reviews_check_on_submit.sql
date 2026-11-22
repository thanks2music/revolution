-- 0019: 下書きを提出する時にも、開催の状態と訪問日の範囲を確かめる (S4 口コミ #162)
--
-- 下書きは星・訪問日が空でも保存でき、提出 (下書き → 審査中) はサーバー (service role) が状態を
-- 書き換えて行う。0018 の開催と訪問日のトリガは「INSERT と、訪問日を変える UPDATE」でしか発火せず、
-- 下書きを書いた時から提出までに開催が中止になった・訪問日が範囲を外れた場合に、DB で止められない。
-- 仕様 (#156) は「提出の時にサーバーと DB の両方で確かめる」なので、状態が下書きから変わる UPDATE でも
-- 確かめる。審査の結果の書き込み (審査中 → 公開 など) は従来どおり確かめない (開催が終わった後も審査は進む)。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.check_review_occurrence()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  occ record;
BEGIN
  -- UPDATE では「訪問日が変わった」か「下書きから提出した」時だけ確かめる
  -- (UPDATE OF visited_on は値が同じでも SET に含まれていれば発火するので、値で比べる)
  IF TG_OP = 'UPDATE'
     AND NEW."visited_on" IS NOT DISTINCT FROM OLD."visited_on"
     AND NOT (OLD."status" = 'draft' AND NEW."status" <> 'draft')
  THEN
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

-- 状態の変化でも発火させる (中身で「下書きから提出」に絞る)
DROP TRIGGER "trg_reviews_check_occurrence" ON "public"."reviews";
--> statement-breakpoint
CREATE TRIGGER "trg_reviews_check_occurrence"
  BEFORE INSERT OR UPDATE OF "visited_on", "status" ON "public"."reviews"
  FOR EACH ROW EXECUTE FUNCTION private.check_review_occurrence();
