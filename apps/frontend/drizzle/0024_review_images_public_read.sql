-- 0024: 公開中の口コミの写真を誰でも読めるようにする (one-more-time #164 の後半、#3 の写真とギャラリー)
--
-- 公開で見えるのは「公開中で、論理削除していない口コミ」の「非公開でない写真」だけ。これは配信側に
-- 写す写真 (lib/reviews/photos/delivery.ts) と同じ条件で、#3 はこの行から配信側の URL を組み立てる。
-- 本人の写真は従来どおり review_images_select_own で読める (非公開の印と理由も)。
--
-- anon に読ませる列は、表示に要る物だけ。非公開の印・理由・作った時刻は読ませない
-- (authenticated は 0015 の表全体の SELECT のまま。公開の行は非公開でないので、印と理由は null)。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE POLICY "review_images_select_public" ON "public"."review_images"
  AS PERMISSIVE FOR SELECT TO "anon", "authenticated"
  USING (
    "hidden_at" IS NULL
    -- 行ごとに主キーで口コミを 1 件だけ見る (公開中の口コミ全体を集めない)
    AND EXISTS (
      SELECT 1 FROM "public"."reviews" r
      WHERE r."id" = "review_images"."review_id"
        AND r."status" = 'published' AND r."deleted_at" IS NULL
    )
  );
--> statement-breakpoint
GRANT SELECT ("id", "review_id", "object_key", "width", "height", "variant_widths", "sort_order")
  ON TABLE "public"."review_images" TO anon;
