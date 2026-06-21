# Supabase Secret Rotation SoP

Revolution の Supabase 関連 secret (DB password / PAT / project ref 等) を rotation する際に、**同期し忘れによる silent failure を防ぐ** ための標準作業手順書 (SoP)。

本 SoP は 2026-06-13〜21 に発生した **本番 + staging Supabase 自動 pause 事故** の教訓 (§5) から作成された。同期し忘れによる 8 日間 silent failure → auto-pause の連鎖を構造的に防ぐことが目的。

> **対象範囲**: Revolution の Supabase 関連 secret 全般。具体的には DB password 再生成 / PAT 再発行 / project ref 変更 / Connection string 構成変更 のいずれかを伴う rotation。

---

## 1. 目的

| | 目的 |
|---|---|
| **再発防止** | 1 つの password / token を rotation した時に、参照する箇所 (GitHub Secrets / Vercel env / Supabase Dashboard) を **すべて同期** することを SoP で強制する |
| **可視化** | rotation 対象 secret と影響範囲を 1 枚のマトリクスで一覧化する |
| **検証** | rotation 後の検証手順 (workflow_dispatch + Supabase MCP / dashboard) を明示し、無検証 merge を防ぐ |

---

## 2. Rotation 対象 secret マトリクス

### 2.1 Production の DB password 再生成時

| 同期対象 | 場所 | secret / 設定名 | 影響する機能 |
|---|---|---|---|
| **GitHub Secrets (repo level)** | https://github.com/thanks2music/revolution/settings/secrets/actions | `SUPABASE_PROD_DB_PASSWORD` | `deploy-supabase-migrations.yml` (production) / `supabase-keepalive.yml` (production) |
| **Vercel env (Production scope)** | Vercel Dashboard > Project Settings > Environment Variables | 該当 DB URL / Supabase Connection string | アプリの実行時 DB 接続 |
| **Supabase Dashboard** | https://supabase.com/dashboard/project/abqsntbvnuttpyixagob/settings/database | Connection string の表示 (情報源として) | 自動更新済 (Supabase 側で新 password 反映) |

### 2.2 Staging の DB password 再生成時

| 同期対象 | 場所 | secret / 設定名 | 影響する機能 |
|---|---|---|---|
| **GitHub Secrets (repo level)** | 同上 | `SUPABASE_STG_DB_PASSWORD` | `deploy-supabase-migrations.yml` (staging) / `supabase-keepalive.yml` (staging) |
| **Vercel env (Preview scope)** | 同上 | 該当 DB URL / Supabase Connection string | preview deploy の DB 接続 (Vercel Preview = Supabase staging を使う構成の場合) |
| **Supabase Dashboard** | https://supabase.com/dashboard/project/womzkyizshrfipvsaals/settings/database | Connection string の表示 | 自動更新済 |

### 2.3 PAT (Personal Access Token) / project ref 変更時

| 同期対象 | 場所 | secret / 設定名 | 影響する機能 |
|---|---|---|---|
| **GitHub Secrets** | 同上 | `SUPABASE_ACCESS_TOKEN` (PAT) | `deploy-supabase-migrations.yml` の `supabase link` |
| **GitHub Secrets** | 同上 | `SUPABASE_PROD_PROJECT_ID` / `SUPABASE_STG_PROJECT_ID` (project ref) | deploy / keep-alive 両方の PGUSER 組み立て |

---

## 3. Rotation 手順 (3 フェーズ)

### Phase A: 事前準備 (rotation の数分前)

```bash
# 1. 影響範囲リストを再確認 (本 SoP §2 を読む)

# 2. 現行 secret の最終更新日を確認 (GitHub Secrets UI または gh CLI)
gh secret list | grep -E "SUPABASE_(PROD|STG|KEEPALIVE)"

# 3. Supabase 両 project が ACTIVE_HEALTHY であることを確認 (rotation 前のベースライン)
#    MCP 経由:
#      mcp__supabase__get_project(id: "abqsntbvnuttpyixagob")  # production
#      mcp__supabase__get_project(id: "womzkyizshrfipvsaals")  # staging
#    両方 status: ACTIVE_HEALTHY を確認
```

### Phase B: Rotation 実行 (順序固定、5 分以内で同期)

```text
Supabase Dashboard で password 再生成 (または PAT 再発行)
    ↓ (即時)
GitHub Secrets を新値で更新 (該当する全 secret、§2 マトリクス参照)
    ↓ (即時)
Vercel env を新値で更新 (Preview/Production 両方の該当 scope)
    ↓
Phase C へ
```

> ⚠️ **順序固定の理由**: Supabase で新 password を確定した瞬間に旧 password は無効化される。GitHub Secrets と Vercel env が古いままだと、その時点から CI/CD と本番アプリが認証失敗を起こす。**5 分以内で 3 箇所の同期を完了** すること。

### Phase C: 事後検証 (rotation の数分後 / 24h 後 / 7 日後)

```bash
# 1. 即時検証: workflow_dispatch で keep-alive 両 job 手動実行
gh workflow run "Supabase Keep-Alive" -f target=both
sleep 30
gh run list --workflow="Supabase Keep-Alive" --limit 1
gh run view <run_id> --log  # 両 job で "Supabase keep-alive ping (production|staging) succeeded." 確認

# 2. 即時検証: deploy workflow を別途 trigger (任意、本物の migration を伴わない workflow_dispatch dry-run)
#    実 deploy の発火は次の PR open / main merge を待つ

# 3. 即時検証: Supabase MCP で両 project が ACTIVE_HEALTHY を維持していることを確認
#    mcp__supabase__get_project(id: "abqsntbvnuttpyixagob")
#    mcp__supabase__get_project(id: "womzkyizshrfipvsaals")

# 4. 24h 後検証: cron 自動実行ログ確認
gh run list --workflow="Supabase Keep-Alive" --limit 4  # 直近 production + staging 各 1 件が success

# 5. 7 日後検証 (rotation 後 1 回のみ): staging が pause していないこと
#    mcp__supabase__get_project(id: "womzkyizshrfipvsaals")  # ACTIVE_HEALTHY
#    本物の 7 日制約を超えても auto-pause しないことの実証
```

---

## 4. Password 文字制約

Supabase で password を再生成する際は **URL-safe な文字のみ** を採用する。

| OK | NG |
|---|---|
| 英数字 (`a-zA-Z0-9`) | `@` `:` `/` `?` `#` `[` `]` |
| ハイフン (`-`) アンダースコア (`_`) ピリオド (`.`) | 空白 / 制御文字 |

理由: PR #244 Phase 1e で URL-unsafe 文字を含む password が DB URL の構築側 (Vercel env) でエンコーディング起因の接続失敗を起こした事案あり。`@t3-oss/env-nextjs` 等の URL validation が NG とする文字を避ける。

> **本 workflow (`supabase-keepalive.yml`) は libpq 環境変数方式で接続するため password の文字制約は緩い** (URL エンコード不要)。ただし Vercel env 等の他箇所では URL 形式で扱われるため、**全箇所横断で URL-safe を保つ** のが安全。

---

## 5. 教訓事案: 2026-06-13〜21 本番 + staging Supabase auto-pause

### タイムライン

| 日付 | 出来事 |
|---|---|
| 2026-05-31 | PR #238/#239 で `supabase-keepalive.yml` 導入 (production のみ対象)。`SUPABASE_KEEPALIVE_DB_PASSWORD` を新規 secret として作成、当時の production password と同値を設定 |
| 2026-06-12 | PR #244 (Crescendolls 本番有効化) マージ、Phase 1e で production DB password 再生成。`SUPABASE_PROD_DB_PASSWORD` のみ更新、**`SUPABASE_KEEPALIVE_DB_PASSWORD` の更新は失念** |
| 2026-06-13 | この日以降、keep-alive cron は古い password で接続を試み続け **silent failure** (`psql: error: ... FATAL: (ENOTFOUND) tenant/user postgres.abqsntbvnuttpyixagob not found`) |
| 2026-06-13〜20 | 8 日連続失敗。GitHub Actions 上は cron 自体は active のままだが、ジョブは赤バツのみで誰も気づかず |
| 2026-06-21 | PR #247 (categories master) の CI `Deploy Supabase Migrations` が `project is paused` で初めて表面化。production + staging とも auto-pause していたことが判明、BOSS dashboard で手動 Resume |

### 学び (この SoP の存在理由)

1. **silent failure は致命的**: cron 失敗を 8 日間誰も気づかなかった。**外形監視 (Sentry / UptimeRobot 等) の追加が真の根本対処** (本 PR scope 外、別 Todoist で起票予定)
2. **keep-alive 専用 secret は存在意義が薄い**: deploy と同じ project の同じ DB を ping するだけなら、**同じ password secret を共有** することで rotation 同期忘れを構造的に排除できる (本 PR で実施)
3. **staging も keep-alive 対象に含めるべき**: staging は構造的に 7 日制約に勝てない設計だった (本 PR で実施)
4. **rotation 時の同期は必ず SoP に従う**: 「password 再生成だけして他箇所の更新を後回し」が事故の温床

---

## 6. チェックリスト (rotation 時にコピペ可)

```text
== Supabase Secret Rotation Checklist ==

対象 (○をつける):
□ production DB password
□ staging DB password
□ SUPABASE_ACCESS_TOKEN (PAT)
□ SUPABASE_PROD_PROJECT_ID / SUPABASE_STG_PROJECT_ID

Phase A: 事前準備
□ 本 SoP §2 マトリクスを再確認
□ gh secret list で現行 secret 最終更新日を確認
□ Supabase MCP get_project で両 project ACTIVE_HEALTHY を確認

Phase B: Rotation 実行 (5 分以内で完了)
□ Supabase Dashboard で password 再生成 (または PAT 再発行)
□ GitHub Secrets を新値で更新 (該当全 secret)
□ Vercel env を新値で更新 (Preview/Production 両方の該当 scope)
□ password の文字制約 (URL-safe) を遵守 (§4 参照)

Phase C: 事後検証
□ 即時: gh workflow run "Supabase Keep-Alive" -f target=both で両 job green
□ 即時: Supabase MCP で両 project ACTIVE_HEALTHY 維持
□ 24h 後: cron 自動実行で両 job success
□ 7 日後 (一度のみ): staging が pause せず ACTIVE_HEALTHY 維持
```

---

## 7. 関連ドキュメント

- 本 SoP の起因事案: SSoT footer 第 32 / 33 回エントリ (2026-06-21 mapping-update / task-start)
- 関連 workflow: `.github/workflows/supabase-keepalive.yml` (本 SoP 適用対象) / `.github/workflows/deploy-supabase-migrations.yml`
- 関連 doc: `docs/operations/supabase-migration-workflow.md` (migration deploy 運用ガイド、本 SoP と相補)
- 公式仕様: [Going into Production — Project Pausing Policy](https://supabase.com/docs/guides/platform/going-into-prod) / [Restore Project After 90-Day Pause](https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause) / [IPv4/IPv6 Compatibility](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP)
- Todoist: 本 SoP 作成タスク [`6gw7Pgr5FJCgqPFg`](https://app.todoist.com/app/task/6gw7Pgr5FJCgqPFg) / 別 PR で対応する [Pro プラン ROI 評価] と [外形監視追加] は別途起票予定
