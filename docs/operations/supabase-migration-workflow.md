# Supabase Migration Deploy Workflow

Revolution の Supabase remote project (`abqsntbvnuttpyixagob` = production / `womzkyizshrfipvsaals` = staging) への migration deploy パイプライン運用ガイド。

本セッション (2026-06-10) で BOSS 確定の **(B) 理想派** に基づく設計を反映。

---

## 1. 全体像

```
[BOSS] commit & push to feature branch
        ↓
[GitHub Actions] PR open
        ↓
        ├─ Vercel: preview deploy 自動発火 (GitHub Integration、業界標準)
        └─ Supabase: deploy-supabase-migrations.yml → staging 適用
        ↓
[BOSS] PR review (claude[bot] + Copilot) → 承認
[BOSS] squash merge to main
        ↓
        ├─ Vercel: production deploy 自動発火
        └─ Supabase: deploy-supabase-migrations.yml → production 適用
        ↓
[Claude] Playwright で golden path 検証 (Phase 2c)
```

---

## 2. 設計方針 (本セッション 2026-06-10 BOSS 確定)

| 項目 | 確定値 | 理由 |
|---|---|---|
| **SSoT** | drizzle (`apps/frontend/drizzle/*.sql`) | 既存 Schema-SDD (zod + drizzle-orm + drizzle-zod) と整合 |
| **Supabase CLI 形式同期** | drizzle SQL を timestamp prefix で `apps/frontend/supabase/migrations/` に複製 | Supabase CLI の `db push` が要求する形式 |
| **環境分離** | production = `abqsntbvnuttpyixagob` / staging = `womzkyizshrfipvsaals` | Free プラン 2 project 枠 (Tony Stark Labs 削除) |
| **CI/CD trigger** | PR open → staging / main merge → production | 公式 [managing-environments.mdx](https://supabase.com/docs/guides/deployment/managing-environments) パターン |
| **GitHub Integration** | Supabase 側は **使わない** (O2 GitHub Actions 一本化) | SSoT 競合回避、GitHub Actions で全制御 |
| **Vercel-Supabase 順序保証** | forward-only migration ルール + concurrency | (C) 並行発火許容、運用ルールでカバー |
| **Secret 命名規則** | `SUPABASE_<ENV>_<RESOURCE>` (例: `SUPABASE_PROD_DB_PASSWORD`) | 業界ベストプラクティス、既存 `SUPABASE_SECRET_KEY` 等との整合 |

---

## 3. drizzle SSoT 維持 + supabase/migrations 同期

### 3.1 ディレクトリ構成

```
apps/frontend/
├── drizzle/                          # ★ SSoT (drizzle-kit 生成)
│   ├── 0000_crescendolls_tables.sql
│   ├── 0001_crescendolls_rls.sql
│   └── meta/                          # drizzle journal
└── supabase/
    └── migrations/                    # ★ Supabase CLI 形式 (drizzle からコピー)
        ├── 20260610100000_crescendolls_tables.sql
        └── 20260610100100_crescendolls_rls.sql
```

### 3.2 ファイル名の変換ルール

- drizzle: `<index>_<name>.sql` (例: `0000_crescendolls_tables.sql`)
- Supabase CLI: `<YYYYMMDDHHMMSS>_<name>.sql` (例: `20260610100000_crescendolls_tables.sql`)

タイムスタンプは **同一 PR 内で連続性を保つ** ように設定 (`100000` → `100100` → `100200` の 1 分刻み)。

### 3.3 新規 migration 追加手順 (将来)

1. `apps/frontend/` で drizzle-kit でスキーマ変更を生成:
   ```bash
   pnpm --filter frontend-nextjs-headless-cms exec drizzle-kit generate
   ```
2. 出力された `apps/frontend/drizzle/<index>_<name>.sql` を確認
3. **手動コピー** で `apps/frontend/supabase/migrations/<timestamp>_<name>.sql` に複製
   ```bash
   cp apps/frontend/drizzle/<index>_<name>.sql \
      apps/frontend/supabase/migrations/$(date +%Y%m%d%H%M%S)_<name>.sql
   ```
4. PR 起案 → CI で staging deploy → BOSS マージ → production deploy

> **将来の自動化候補** (派生 Backlog): `pnpm sync:migrations` 等の script で drizzle 生成 SQL を `supabase/migrations/` に自動同期。MVP 段階では手動で十分。

---

## 4. CI/CD workflow

`.github/workflows/deploy-supabase-migrations.yml` を参照。

### 4.1 trigger

| イベント | 対象環境 | 条件 |
|---|---|---|
| `pull_request` to main | staging | `apps/frontend/supabase/migrations/**` or workflow YAML 変更時 |
| `push` to main | production | 同上 |
| `workflow_dispatch` (手動) | staging or production | BOSS 手動実行 (緊急時) |

### 4.2 必要な GitHub Secrets (Repository settings)

| Secret 名 | 値 | 取得元 |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | BOSS Supabase アカウント PAT (環境非依存) | https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROD_PROJECT_ID` | `abqsntbvnuttpyixagob` | Revolution project URL |
| `SUPABASE_STG_PROJECT_ID` | `womzkyizshrfipvsaals` | Revolution Staging project URL |
| `SUPABASE_PROD_DB_PASSWORD` | production DB password | Supabase Dashboard → Database → Settings |
| `SUPABASE_STG_DB_PASSWORD` | staging DB password | Phase 1a (staging 作成) 時に BOSS 保管 |

### 4.3 concurrency

同一環境への同時 deploy を防ぐ。staging と production は別グループのため並行可。PR 番号別の staging グループは異なる PR 間の競合を回避。

---

## 5. Vercel-Supabase 順序保証 (forward-only migration ルール)

### 5.1 課題

Vercel と Supabase は **並行発火** する設計 (BOSS 方針: Vercel GitHub Integration 維持):
- main merge → Vercel が production deploy 開始 (新 schema 前提のコード)
- 同時に GitHub Actions が Supabase migration を流す
- 通常 Vercel deploy = 1-2 分、Supabase migration = 数十秒 〜 数分
- → **新コードが古い schema にアクセスする時間帯**が発生する可能性

### 5.2 解決: forward-only migration ルール (必須)

**すべての migration は backward-compatible でなければならない**。新コードが古い schema でも、古いコードが新 schema でも動作する形を保つ。

| OK パターン (forward-only) | NG パターン (breaking) |
|---|---|
| 新カラム追加 (NULL 許容 or DEFAULT 付き) | 既存カラムの削除 |
| 新テーブル追加 | 既存テーブルの DROP |
| 新インデックス追加 | 既存カラムの型変更 (互換性なし) |
| 既存カラムの NOT NULL 制約 **削除** | 既存カラムへの NOT NULL 制約 **追加** (既存 NULL 行があると失敗) |
| 新トリガー / RLS policy 追加 | 既存 PRIMARY KEY の変更 |

### 5.3 breaking change が必要な場合

2 段階 migration で対応:

1. **PR #N**: 新 schema 追加 (旧と新が共存) → main merge → production deploy
2. **コードを新 schema 利用に切替** (PR #N+1) → main merge → production deploy
3. **PR #N+2**: 旧 schema 削除 → main merge → production deploy

---

## 6. ロールバック

### 6.1 migration の rollback

Supabase CLI は **自動 rollback 機能なし**。問題発生時は:

1. **新規 migration ファイルを追加** (rollback 用、CREATE TABLE → DROP TABLE 等)
2. PR 起案 → 通常 deploy フローで適用

### 6.2 Free プラン制約

- 自動バックアップなし
- PITR (Point-In-Time Recovery) なし → 重大 migration 前に手動 `pg_dump` 推奨
- 派生 Backlog 候補: 日次 `pg_dump` を GitHub Actions cron で artifact 保存

---

## 7. 派生 Backlog 候補 (Phase 2 以降)

| 項目 | 内容 |
|---|---|
| GitHub Actions Environments 機能 | production への secret access に承認フロー追加 (Vercel scope 類似)、Settings → Environments で `production` / `staging` 作成 |
| drizzle → supabase/migrations 自動同期 script | `pnpm sync:migrations` 等で手動コピー手間を削減 |
| 日次 pg_dump バックアップ | Free プラン制約への対策 |
| ~~`SUPABASE_KEEPALIVE_DB_PASSWORD` 重複整理~~ | **✅ 2026-06-21 完了** (Todoist `6gw7Pgr5FJCgqPFg`)。`SUPABASE_PROD_DB_PASSWORD` / `SUPABASE_STG_DB_PASSWORD` に統一済、`supabase-keepalive.yml` を 2 job 化 (本番+staging) + secret rotation SoP を新規追加。詳細手順は [`supabase-secret-rotation-sop.md`](./supabase-secret-rotation-sop.md) を参照 |
| ~~Migration deploy の事故再発防止 (CI 事前整合性チェック + 復旧 SoP)~~ | **✅ 2026-06-22 完了** (PR #249 事故対応)。`deploy-supabase-migrations.yml` に `supabase db push --dry-run` の pre-flight step 追加 + 本ドキュメント §9 (修正運用ルール) + §10 (復旧 SoP) を新規追加 |
| Vercel deploy GitHub Actions 化検討 | フロント deploy の経路統一 (MVP 後判断、業界標準では Vercel Integration 推奨) |

---

## 8. 参考

### See also (運用ドキュメント)

- [`supabase-secret-rotation-sop.md`](./supabase-secret-rotation-sop.md) — DB password / PAT / project ref rotation 時の標準作業手順書 (3 フェーズ手順 + 同期対象 secret マトリクス + 教訓事案 + チェックリスト)。**本 doc と相補関係**: migration deploy パイプライン (本 doc) ↔ secret rotation 運用 (SoP)

### 外部参照

- 親課題 Todoist: `6gqX6V5Vh2p3XW7g` (Supabase, GitHub, Vercel を「(B) 理想派」の状態に環境構築)
- handoff doc: `docs/handoff/2026-06-09-crescendolls-production-handoff.md`
- 本セッション (2026-06-10) BOSS 確定の (B) 理想派
- Supabase 公式: [Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- Supabase 公式: [Branching (Free OK の自動 deploy 機能)](https://supabase.com/docs/guides/deployment/branching)
- Supabase 公式 CLI: [`supabase db push --dry-run`](https://github.com/supabase/cli) / [`supabase migration list`](https://github.com/supabase/cli) / [`supabase migration repair`](https://github.com/supabase/cli)
- Twelve-Factor App: [config](https://12factor.net/config)
- GitHub Actions Environments: [Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)

---

## 9. 未マージ migration の修正運用 (再発防止)

> 2026-06-22 追加 (PR #249 事故対応)。本節は **「PR open 中 (= main マージ前) に migration ファイルを修正したい時の運用ルール」** を 3 シナリオで定義する。

### 9.1 なぜルールが必要か

`deploy-supabase-migrations.yml` は `pull_request` trigger で **PR push のたびに staging deploy を試みる** (公式 [managing-environments](https://supabase.com/docs/guides/deployment/managing-environments) の推奨パターン)。一度 staging に適用された migration は **remote の `supabase_migrations.schema_migrations` テーブルに version 記録が残る**。その後 local の migration ファイルを **rename (timestamp 変更) または物理削除** すると、`supabase db push` が `Remote migration versions not found in local migrations directory.` エラーで失敗する (PR #249 で実証)。

CI 側では `§4` の pre-flight step (`db push --dry-run`) が事前にこの不整合を検知して止めるが、復旧には人手介入 (staging DB のロールバック + repair) が要るため、**そもそも発生させない運用ルール**が必要。

### 9.2 3 シナリオ別の対応

| シナリオ | 状態 | 対応方針 |
|---|---|---|
| **A. local commit のみ (未 push)** | staging に何も適用されていない | **自由に修正可**。`git commit --amend` / `git rebase -i` / migration ファイル名変更すべて OK |
| **B. PR push 済、`deploy-staging` 未完了 (実行中 or queued)** | concurrent execution の可能性あり | 修正前に `gh run watch <run_id>` で **deploy-staging 完了を待つ** → 完了状態に応じて A or C へ移行 |
| **C. PR push 済、`deploy-staging` 完了済** ← **PR #249 はこのケース** | staging に旧 migration 適用済 (remote `schema_migrations` に version 記録あり) | **migration ファイル名を変えてはいけない**。下記 2 オプションから選択 |

### 9.3 シナリオ C の 2 オプション

#### Option C-1 (推奨): 新規 migration を追加 (forward-only)

旧 migration ファイルは**そのまま残し**、修正は **新しい migration として追加**する。

```
apps/frontend/supabase/migrations/
  20260621101241_titles.sql           ← 旧 (修正したい内容、staging 適用済)
  <NEW_TIMESTAMP>_titles_fix.sql      ← 新 (修正分を ALTER/DELETE 等で表現)
```

##### 新 timestamp の生成ルール (2026-06-27 自己レビュー #4 採用)

新 migration の timestamp は **「現在 staging/production に適用済のいずれの version よりも厳密に大きい」必要がある**。Supabase CLI は timestamp の lexicographic 順で migration を適用するため、適用済 version より小さい timestamp を持つ新ファイルを push すると `supabase db push` が `migration history is older than ...` 等で reject する。

生成手順:

```bash
cd revolution/apps/frontend

# 1. 現在の applied version の最大値を staging で確認 (production は別途)
#    GitHub Secrets `SUPABASE_STG_DB_PASSWORD` / `SUPABASE_STG_PROJECT_ID` で
#    pooler URL を組み立てて `supabase migration list` を実行する。
#    手元では下記 (例: staging) で取得可。
supabase migration list --db-url "postgresql://postgres.<STG_REF>:<ENCODED_PWD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
#    → LOCAL / REMOTE 列の最大 timestamp を確認

# 2. UTC 現在時刻で新 timestamp を生成 (max_applied より必ず大きくなる)
NEW_TS=$(date -u +%Y%m%d%H%M%S)
echo "$NEW_TS"

# 3. ファイル作成
cp ../drizzle/<生成された drizzle file>.sql supabase/migrations/${NEW_TS}_titles_fix.sql

# 4. push 前に再度 list で順序確認
supabase migration list --db-url "..."
#    → 新 ${NEW_TS} が末尾にあり、既存のいずれよりも大きいこと
```

重要な落とし穴:
- **timezone**: `date` (TZ なし) を使うと local tz の時刻になり、UTC 適用済 version より小さくなり得る。**必ず `date -u`** (UTC 固定) を使う
- **コピペした例**: 本ドキュメントの `<NEW_TIMESTAMP>` placeholder は埋めずに使わない (例として固定値を残すと将来「2026-06-22 から見て 2027 年に発生した不整合」で逆転する)

- ✅ staging と production が同じ migration 系列を辿る (forward-only ルール準拠、`§5.2` 参照)
- ✅ CI fail せず、復旧手順不要
- ✅ git 履歴上で「何を修正したか」が明示される
- ⚠ migration ファイル数が増える (PR 内で複数 fix 回した場合)

#### Option C-2 (例外): 旧 migration を上書き + staging を repair

旧ファイル名のまま **内容のみ変更** (timestamp 不変)。この場合、**staging の repair 作業が必須** (§10 SoP 実施)。

- ✅ migration ファイル数は最小
- ❌ staging への手動 SQL 介入が必要 (BOSS 関与必須、誤環境リスク)
- ❌ 復旧中は CI が fail し続ける (作業時間中の継続的 noise)

**Option C-2 を選ぶケース**: 旧 migration の content が「明らかな typo」「production にも絶対入ってほしくない情報 (機密 / IP 侵害等)」で、forward 修正では disclosure が止まらない場合のみ。それ以外は C-1 を採用する。

### 9.4 判断フローチャート

```text
migration ファイルを修正したい
  ↓
Q1: ローカルに commit を push したか?
  ├─ No → シナリオ A (自由に修正)
  └─ Yes ↓
       Q2: deploy-staging job が完了したか?
         ├─ No (queued/in_progress) → シナリオ B (待機 → A or C へ)
         └─ Yes ↓
              Q3: 修正は forward (ALTER/INSERT/DELETE) で表現可能?
                ├─ Yes → シナリオ C-1 (新 migration 追加、推奨)
                └─ No (上書き必須) → シナリオ C-2 (§10 SoP で staging repair)
```

---

## 10. staging migration_history 不整合からの復旧手順 (SoP)

> 2026-06-22 追加 (PR #249 復旧経緯の一般化)。シナリオ C-2 (§9.3) を選択した場合、または何らかの理由で staging の remote `schema_migrations` と local files が乖離した場合の手順。

### 10.1 適用対象

- staging Supabase (project ref は GitHub Secrets `SUPABASE_STG_PROJECT_ID` で確認、`Revolution Staging` プロジェクト) の `supabase_migrations.schema_migrations` に「local migration files に存在しない version」が残存している状態
- production への適用は **絶対に行わない**。production の repair は別 SoP (**未策定、別タスク化推奨**)。`.github/workflows/deploy-supabase-migrations.yml` の production job にも本 PR で同じ pre-flight gate を追加した。**ただし** claude[bot] PR #250 review R2 #1 採用で、production 側 pre-flight fail 時の annotation は **§10 (本 SoP) を案内せず、直接 BOSS escalation を要求する形式に差し替えた** (本 §10 は staging-only であり、production にそのまま適用すると本番事故を悪化させるため)。production 側で fail した時の暫定対応は workflow YAML 内のインラインコメント (`Pre-flight migration history consistency check` step) を参照すること
- project ref をハードコードしない: 実行時は GitHub Secrets (`SUPABASE_STG_PROJECT_ID` / `SUPABASE_PROD_PROJECT_ID`) で取得 + Supabase dashboard で Project 名 (`Revolution Staging` / `Revolution`) と照合する習慣を §10.4 チェックリストで強制する

> **Out of scope (本 SoP 範囲外)**: production の migration_history 不整合復旧 SoP は未策定。発生確率は低い (production への適用は main マージ時のみ、PR レビューで pre-flight 通過が確認済のはず) が、ゼロではない。後続タスクで策定予定。

### 10.2 手順 (6 フェーズ)

#### Phase 1: 状態確認

`mcp__supabase__execute_sql` (Supabase MCP) で staging project の current state を取得:

```sql
-- 1. migration history 一覧
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;

-- 2. 関連テーブルの存在確認
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' ORDER BY table_name;

-- 3. 関連 CHECK 制約の確認 (該当テーブルがあれば)
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.<table>'::regclass AND contype = 'c'
 ORDER BY conname;
```

local の `apps/frontend/supabase/migrations/*.sql` と突合し、**不整合な version を特定**。

#### Phase 2: DB 状態の rollback (BOSS 手動実行)

対象 migration が CREATE した object を staging Supabase で削除する。**Claude による自動実行は Auto Mode classifier が destructive 操作 (`DROP TABLE`) をブロックするため、BOSS が Supabase dashboard SQL Editor で実行する**。

**一般化ルール (claude[bot] PR #250 review #4 採用)**: 対象 migration の内容に応じて逆操作を実行する。CASCADE の影響範囲は事前に必ず確認する。

> **重要 (2026-06-27 自己レビュー #3 採用)**: Supabase dashboard SQL Editor および `mcp__supabase__execute_sql` (Supabase MCP) は **psql backslash metacommand (`\d`, `\d+`, `\dt` 等) をサポートしない**。下記の portable SQL クエリを使うこと。

CASCADE 影響範囲確認用 SQL (Supabase dashboard / MCP どちらでも動く):

```sql
-- 対象テーブルに依存する object 一覧 (FK / view / trigger / index 等)
SELECT
  classid::regclass AS dep_type,
  objid::regclass   AS dep_object,
  refclassid::regclass AS ref_type,
  refobjid::regclass   AS ref_object,
  deptype
FROM pg_depend
WHERE refobjid = 'public.<table_name>'::regclass
  AND deptype IN ('n','a')  -- normal + auto (extension/internal は除外)
ORDER BY classid, objid;

-- 対象テーブルを参照する FK の一覧
SELECT
  con.conname,
  con.conrelid::regclass AS from_table,
  con.confrelid::regclass AS to_table
FROM pg_constraint con
WHERE con.confrelid = 'public.<table_name>'::regclass
  AND con.contype = 'f';
```

| migration 操作 | 逆操作 |
|---|---|
| `CREATE TABLE` | `DROP TABLE ... CASCADE` (依存関係を上記 `pg_depend` クエリで事前確認) |
| `CREATE INDEX` | `DROP INDEX IF EXISTS` |
| `CREATE TYPE` (ENUM) | `DROP TYPE IF EXISTS` (使用箇所を `pg_type` + `pg_depend` で確認) |
| `CREATE POLICY` | `DROP POLICY IF EXISTS` |
| `ALTER TABLE ... ADD CONSTRAINT` | `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` |
| `ALTER TABLE ... ADD COLUMN` | `ALTER TABLE ... DROP COLUMN IF EXISTS` (データ消失リスク、要バックアップ) |
| `INSERT INTO` (seed) | `DELETE FROM ... WHERE ...` (条件を厳密に) |
| `CREATE FUNCTION` / `CREATE TRIGGER` | `DROP FUNCTION` / `DROP TRIGGER` |

```sql
-- 例 (PR #249 のケース): titles テーブル + 関連 RLS policy + 行を一掃
DROP TABLE public.titles CASCADE;

-- ALTER で追加した CHECK 制約を戻す例 (categories retrofit の rollback シナリオ等)
-- ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_not_blank;
-- ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_format;
-- ALTER TABLE public.categories ADD CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9-]+$');
```

URL: `https://supabase.com/dashboard/project/<SUPABASE_STG_PROJECT_ID>/sql` (project ref は GitHub Secrets `SUPABASE_STG_PROJECT_ID` を参照、Project 名「**Revolution Staging**」を URL とヘッダで二重確認)

#### Phase 3: migration_history からの削除 (Claude 実行可)

```sql
DELETE FROM supabase_migrations.schema_migrations WHERE version = '<bad_version>';
```

Supabase MCP の `execute_sql` で実行可 (DELETE は classifier をパスする)。

#### Phase 4: 検証

`mcp__supabase__list_tables` + Phase 1 の SQL で「new migration 適用前の clean state」を再確認:

- `schema_migrations` から bad version が消えていること
- 該当テーブル/制約が消えていること
- 他の object に影響がないこと (CASCADE による意図せぬ削除がないか)

#### Phase 5: CI rerun

```bash
gh run rerun <failed_run_id> --failed
```

failed jobs のみ再実行。`deploy-staging` で新 step (pre-flight check) と既存 step (push) が両方 PASS することを確認。

#### Phase 6: 再検証

staging Supabase で **新 migration が想定通り適用されたこと** を Phase 1 の SQL 再実行 + `mcp__supabase__list_tables` で実機確認。

### 10.3 教訓事案 (PR #249, 2026-06-21〜22)

| 項目 | 値 |
|---|---|
| **不整合 version** | `20260621101241` (旧 titles migration、8 行 sample seed 含む) |
| **新 version** | `20260621110514` (空 seed + strict CHECK + categories retrofit) |
| **影響範囲** | staging のみ (production は main マージ前のため未影響) |
| **復旧作業時間** | 約 30 分 (調査 15 分 + 手動 SQL 5 分 + CI rerun + 検証 10 分) |
| **教訓** | (1) 同一 PR 内で migration ファイル名 (timestamp) を変えるなら staging への適用状態を先に確認する。(2) Auto Mode classifier は staging への DROP TABLE もブロックする (本番安全側、運用は BOSS 1 度承認で完結)。(3) CI 事前チェック (`§4` の pre-flight step) を本 PR で導入したため、今後は実行前に明示エラーで停止する |

### 10.4 チェックリスト (BOSS 用、SoP 実施時に prepend)

- [ ] staging project ref が GitHub Secrets `SUPABASE_STG_PROJECT_ID` の値であることを Supabase dashboard URL で再確認 (Project 名「Revolution Staging」を画面ヘッダで二重確認、production `SUPABASE_PROD_PROJECT_ID` = 「Revolution」と混同しないこと)
- [ ] Phase 1 で current state を記録 (post-mortem 用)
- [ ] Phase 2 の DROP / ALTER 逆操作が対象 object のみで CASCADE 範囲を理解 (§10.2 一般化ルール表 + 上記 `pg_depend` クエリで事前確認、psql `\d+` は MCP / dashboard で動かない)
- [ ] Phase 3 の DELETE 対象 version が「local に存在しない version」のみであること
- [ ] Phase 5 の rerun 後に Phase 6 で実機 verification を必ず実施
- [ ] post-mortem 内容を本ファイル §10.3「教訓事案」表に追記
