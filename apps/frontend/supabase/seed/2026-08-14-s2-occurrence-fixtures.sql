-- =============================================================================
-- S2 画面確認用フィクスチャ (staging 専用 / production へ流さないこと)
-- =============================================================================
--
-- ## なぜ必要か
--
-- `mvp-definition.md` A-3-a の「シードデータが投入され、S2 の画面確認ができる」
-- を満たすため。2026-08-14 実測時点で staging / production とも
-- titles / venues / events / occurrences は **すべて 0 件**で、
-- `generateStaticParams` が 0 パスしか返さず**開催詳細ページを描画できなかった**。
--
-- ## これはコンテンツではない
--
-- 実データは **S3 (記事マージ → GitHub Actions → Postgres upsert)** が入れる。
-- 本ファイルは S3 が繋がる前にページの描画を確認するための**足場**であり、
-- S3 稼働後は不要になる。`strategy.md` §5-2 で S3 の依存が S2 である以上、
-- 「ページを作る → 取り込みを作る」の順になり、この空白期間は設計どおり。
--
-- ## 適用先の制約 (重要)
--
-- **staging (womzkyizshrfipvsaals) のみ。production (abqsntbvnuttpyixagob)
-- には適用しない。** production は公開面であり、偽の開催情報を出すと
-- 「実運用未開始だから URL 移行の影響ゼロ」(D8) の前提そのものを壊す。
--
-- ## 冪等性
--
-- 自然キー (`titles.slug` / `venues.slug` / `events.slug` /
-- `occurrences(event_id, slug)`) の ON CONFLICT で upsert する。
-- 何度流しても行が重複しない。
--
-- ## 日付を相対で置く理由
--
-- `occurrence_view` の status は **JST の現在日と比較して導出**される
-- (`0016` の CASE 式)。固定日付を書くと時間の経過で scheduled が ended に
-- 変わり、「4 状態を網羅している」という前提が黙って崩れる。
-- そのため今日を基準にした相対日付で置き、再実行すれば常に 4 状態が揃う。
--
-- ## verified = true にしている理由
--
-- `occurrence_view` は `security_invoker = on` のため、anon で読むと
-- `occurrences_select_verified` が効いて `verified = true` の行しか返らない。
-- false のままだと**ページから 1 件も見えない**ので、フィクスチャは true で入れる。
--
-- ## cancelled を入れていない理由
--
-- 中止の扱いは BOSS 判断で後回し (2026-08-14)。中止イベントの詳細ページは
-- デザイン未作成 (C-3)。view は `cancelled` を返し得るのでコード側には
-- 落ちないフォールバックを置くが、フィクスチャには含めない。
-- =============================================================================

begin;

-- ── 作品 ──────────────────────────────────────────────────────────────
insert into public.titles (slug, name, name_kana, kind)
values ('seed-kaiju-nichijou', 'シード怪獣の日常', 'しーどかいじゅうのにちじょう', 'anime')
on conflict (slug) do update
  set name = excluded.name,
      name_kana = excluded.name_kana,
      kind = excluded.kind;

-- ── 会場 ──────────────────────────────────────────────────────────────
-- 4 件目 (online-seed) は venue_id を使わずに venue_label だけで開催を表す
-- ケース (オンライン開催) の確認用ではなく、実会場 3 件 + ラベル運用 1 件で
-- 「会場マスタあり / ラベルのみ」の両経路を描画で確認するために置いている。
insert into public.venues (slug, name, prefecture, city)
values
  ('seed-shibuya-parco', 'シード渋谷パルコ', '東京都', '渋谷区'),
  ('seed-umeda-loft', 'シード梅田ロフト', '大阪府', '大阪市北区'),
  ('seed-sakae-parco', 'シード栄パルコ', '愛知県', '名古屋市中区')
on conflict (slug) do update
  set name = excluded.name,
      prefecture = excluded.prefecture,
      city = excluded.city;

-- ── 企画 ──────────────────────────────────────────────────────────────
-- primary_category_id は NOT NULL FK。collabo-cafe (id=1) を slug で引く
-- (id 直書きは categories の採番に依存するため避ける)。
insert into public.events (slug, name, primary_category_id, description, official_url)
select
  'seed-kaiju-nichijou-cafe',
  'シード怪獣の日常 × OH MY CAFE',
  c.id,
  'S2 の画面確認用フィクスチャ。実データではない。',
  'https://example.com/seed-kaiju-nichijou-cafe'
from public.categories c
where c.slug = 'collabo-cafe'
on conflict (slug) do update
  set name = excluded.name,
      primary_category_id = excluded.primary_category_id,
      description = excluded.description,
      official_url = excluded.official_url;

-- ── 企画 ⇄ 作品 / カテゴリ の紐付け ──────────────────────────────────
insert into public.event_titles (event_id, title_id)
select e.id, t.id
from public.events e, public.titles t
where e.slug = 'seed-kaiju-nichijou-cafe'
  and t.slug = 'seed-kaiju-nichijou'
on conflict do nothing;

insert into public.event_categories (event_id, category_id)
select e.id, c.id
from public.events e, public.categories c
where e.slug = 'seed-kaiju-nichijou-cafe'
  and c.slug = 'collabo-cafe'
on conflict do nothing;

-- ── 開催 (occurrence_view の 4 状態を網羅) ────────────────────────────
--
--   scheduled   : 開催前            starts_on > 今日
--   ongoing     : 開催中            starts_on <= 今日 <= ends_on
--   ended       : 終了              ends_on < 今日
--   unscheduled : 日程未発表        starts_on is null   ← 5 つ目の状態 (2026-08-09)
--
-- ★ ongoing の残日数が 3 段階すべてを踏むよう、ends_on を「今日 +25 日」に置く。
--   3 段階の境界確認は残日数コンポーネント側の単体テストで行い、ここでは
--   「残日数が出ること」だけを目視できれば足りる。
insert into public.occurrences
  (event_id, venue_id, venue_label, slug, starts_on, ends_on, verified)
select
  e.id, v.id, null, s.slug, s.starts_on, s.ends_on, true
from public.events e
cross join lateral (
  values
    -- slug,          venue_slug,             starts_on,                                            ends_on
    ('tokyo-shibuya',  'seed-shibuya-parco',  (now() at time zone 'Asia/Tokyo')::date - 10,        (now() at time zone 'Asia/Tokyo')::date + 25),
    ('osaka-umeda',    'seed-umeda-loft',     (now() at time zone 'Asia/Tokyo')::date + 14,        (now() at time zone 'Asia/Tokyo')::date + 45),
    ('aichi-sakae',    'seed-sakae-parco',    (now() at time zone 'Asia/Tokyo')::date - 90,        (now() at time zone 'Asia/Tokyo')::date - 60)
) as s(slug, venue_slug, starts_on, ends_on)
join public.venues v on v.slug = s.venue_slug
where e.slug = 'seed-kaiju-nichijou-cafe'
on conflict (event_id, slug) do update
  set venue_id = excluded.venue_id,
      venue_label = excluded.venue_label,
      starts_on = excluded.starts_on,
      ends_on = excluded.ends_on,
      verified = excluded.verified;

-- unscheduled: 日程未発表。会場マスタを持たず venue_label だけで表す運用も
-- 同時に確認する (全国チェーンで頻出、2026-08-09 の LTR 50 件調査)。
insert into public.occurrences
  (event_id, venue_id, venue_label, slug, starts_on, ends_on, verified)
select e.id, null, 'シード福岡パルコ (仮)', 'fukuoka-tenjin', null, null, true
from public.events e
where e.slug = 'seed-kaiju-nichijou-cafe'
on conflict (event_id, slug) do update
  set venue_id = excluded.venue_id,
      venue_label = excluded.venue_label,
      starts_on = excluded.starts_on,
      ends_on = excluded.ends_on,
      verified = excluded.verified;

commit;

-- ── 検算 ──────────────────────────────────────────────────────────────
-- 4 状態が揃っていることを確認する。行数ではなく **status の集合**を見る
-- (行数だけ見ると日付がずれて状態が偏っても気づけない)。
select status, count(*) as n
from public.occurrence_view ov
join public.events e on e.id = ov.event_id
where e.slug = 'seed-kaiju-nichijou-cafe'
group by status
order by status;
