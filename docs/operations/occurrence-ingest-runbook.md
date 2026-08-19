# occurrence 取り込み Runbook (S3、staging 限定)

記事マージを起点に `event_data` を staging Supabase へ upsert するパイプラインの運用手順。
mvp-definition A-4 / A-5-a のチェック項目「取り込み失敗時のロールバック手順が runbook に記載されている」に対応する。

- **workflow**: `.github/workflows/ingest-occurrences.yml`
- **CLI**: `apps/frontend/scripts/ingest-occurrences.ts` (`pnpm --filter frontend ingest:occurrences`)
- **seed CLI**: `apps/frontend/scripts/seed-masters.ts` (`pnpm --filter frontend seed:masters`)
- **判断ロジック (品質ゲート G1〜G8)**: `apps/frontend/lib/ingest/plan-ingest.ts` (設計の正本: `one-more-time/docs/event-review-data-model.md` §8.2)

---

## 1. 通常フロー (人手ゼロ)

```
記事 PR マージ (main)
  → update-mdx-article-index.yml が article-index.json を再生成して main へ commit
  → その push を Ingest Occurrences (staging) が拾う
  → 既知マスタと照合して upsert (既知に全一致 = verified=true で即公開)
  → 結果は Actions run の Job Summary で確認
```

書き込み先は **staging のみ**。production への展開は採番規約が実測で固まってから
(2026-08-15 BOSS 確定。favorites.target_key の opaque key 化も production 前提条件)。

## 2. 手動実行

Actions → `Ingest Occurrences (staging)` → Run workflow:

- `dry_run: true` (既定) — 計画とキューの表示のみ。**seed 直後や規約変更後はまず dry-run**
- `dry_run: false` — 実書き込み

ローカルから:

```bash
cd apps/frontend
INGEST_DATABASE_URL='<staging pooler URL>' pnpm ingest:occurrences --dry-run
```

> ⚠️ **Actions の実行と重ねない**。insert / update の判定は run 開始時のスナップショットで決まるため、
> Actions の run (concurrency で直列化されるのは Actions 同士のみ) とローカル実行が同時に走ると
> `occurrences_event_slug_uniq` 違反でその event が失敗しうる。失敗しても event 単位で隔離され、
> 冪等なので再実行すれば回復する。

## 3. 人手キューの捌き方

キューは Job Summary の表 + artifact `ingest-queue-report` (ingest-queue.json)。
reason ごとに対処が違う:

| reason | 意味 | 対処 |
|---|---|---|
| `unknown_venue` | venue_label はあるが名寄せで解決できない (新規会場 or 表記ゆれ) | **templates の `venue-master.yaml` へ追記** (新規会場は entry、表記ゆれは aliases) → §4 の seed → 再実行 |
| `unknown_title` | title_slug が titles にも title_aliases にも無い | **templates の `title-romaji-mapping.yaml`** へ entry 追加 (kind 必須) or 既存 entry の aliases へ追加 → seed → 再実行。occurrence は verified=false で入っているので再実行で true に昇格する |
| `venue_label_missing` / `venue_label_equals_event_name` / `venue_label_concatenated` | 抽出が壊れている (YAML では直らない) | 記事側の再生成 or 抽出改善タスクへ。会場が実在するなら venue-master 追記だけでは解決しない点に注意 |
| `unknown_primary_category` | categories (23 件) に無い分類 | 通常は起きない。起きたら抽出プロンプトの enum 逸脱なので AI Writer 側の調査 |
| `missing_event_identity` | event_name / event_slug 欠落 | 記事の event_data が不完全。再生成が必要 |
| `missing_title_slugs` | title_slugs が空配列 | 記事の event_data が不完全 (タイトル紐付けゼロの event は公開しない)。再生成が必要 |
| `slug_conflict_unresolvable` | 年月接尾辞まで衝突 | 手動で occurrence を整理する (稀)。なお**同一年月内の日付不一致は再演ではなく「訂正」として自動 update** されるため、ここに落ちるのは月をまたぐ複数回の再演が絡むケースのみ |
| `unknown_supplementary_category` / `event_name_mismatch` | 非ブロッキングの警告 | event_categories が張れない / 名は先勝ち。気になる場合のみ対応 |

**承認ループ (naming doc 確定 1)**: 人手キュー → BOSS が templates YAML を拡充 →
seed → 再実行、が基本。**YAML が真実源で、AI 出力のゆれを正準に昇格させない。**

## 4. マスタの seed / 再 seed

templates の YAML を更新したら (PR マージ後):

```bash
cd apps/frontend
TEMPLATES_SOURCE_PATH=<revolution-templates のローカルパス> \
SEED_DATABASE_URL='<staging pooler URL>' \
pnpm seed:masters            # 冪等 upsert
pnpm seed:masters --verify   # article-index.json の解決率を確認
```

- 別エンティティ間の alias 衝突・既存 alias の付け替えは**自動では行われず exit 1** で
  止まる。人手で判断してから YAML を直す
- pooler URL の形式は `postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`

## 5. 失敗時の対応 / ロールバック

### 5.1 まず知っておくこと

- **取り込みは冪等** (events = slug / occurrences = (event_id, slug) を自然キーに upsert)。
  **基本の復旧は「原因を直して再実行」**
- event 単位のトランザクションなので、1 event の失敗は他 event を止めない
  (失敗は Job Summary とログに出て exit 1)
- seed 前に ingest が走っても壊れない — 全 venue が unknown_venue でキューに落ちるだけ。
  seed 後に再実行すれば回収できる

### 5.2 誤ったデータを入れてしまった場合 (staging 限定の手順)

1. 対象を特定: Job Summary の event 一覧 / `ingest-queue.json`
2. staging へ SQL で削除 (occurrences は events に cascade しないため子から):

```sql
-- 対象 event の occurrence を消す (reviews が付いている場合は S4 以降の話なので現状は無い)
delete from occurrences where event_id = (select id from events where slug = '<event_slug>');
delete from event_titles where event_id = (select id from events where slug = '<event_slug>');
delete from event_categories where event_id = (select id from events where slug = '<event_slug>');
delete from events where slug = '<event_slug>';
```

3. 原因 (YAML / 記事 / コード) を直して `workflow_dispatch` で再実行

### 5.3 マスタを誤って seed した場合

- `venues` / `titles` の name / 所在地の誤りは **YAML を直して再 seed** (upsert で上書きされる)
- **slug を変えたい場合は注意**: 旧 slug の行は upsert では消えない。occurrence が
  参照済み (FK restrict) なら付け替えを先に行う。手順に迷ったら削除せず BOSS へ

## 6. 検証クエリ (read-only)

```sql
select count(*) from events;                                   -- 期待: 記事のユニーク企画数
select count(*), count(*) filter (where verified) from occurrences;
select status, count(*) from occurrence_view group by status;  -- service_role は未承認も見える
-- 会場マスタの解決状況
select o.slug, o.verified, v.name from occurrences o left join venues v on v.id = o.venue_id;
```

初回投入 (記事 9 本) の期待値: events 9 / occurrences 29 (30 中 1 件は
`OH MY CAFE` がブランド粒度のため unknown_venue でキュー) / verified 29。

## 7. production への展開条件 (このパイプラインではまだやらない)

- 採番規約と名寄せの挙動が staging の実データで安定している
- `favorites.target_key` の opaque key 化が閉じている (strategy.md §5-0)
- production 用 secrets の追加と workflow の環境分岐は**別 PR で BOSS 判断**
