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
| `SUPABASE_KEEPALIVE_DB_PASSWORD` 重複整理 | `SUPABASE_PROD_DB_PASSWORD` に統一、`supabase-keepalive.yml` 参照変更、旧 secret 削除 |
| Vercel deploy GitHub Actions 化検討 | フロント deploy の経路統一 (MVP 後判断、業界標準では Vercel Integration 推奨) |

---

## 8. 参考

- 親課題 Todoist: `6gqX6V5Vh2p3XW7g` (Supabase, GitHub, Vercel を「(B) 理想派」の状態に環境構築)
- handoff doc: `docs/handoff/2026-06-09-crescendolls-production-handoff.md`
- 本セッション (2026-06-10) BOSS 確定の (B) 理想派
- Supabase 公式: [Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- Supabase 公式: [Branching (Free OK の自動 deploy 機能)](https://supabase.com/docs/guides/deployment/branching)
- Twelve-Factor App: [config](https://12factor.net/config)
- GitHub Actions Environments: [Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
