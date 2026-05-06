# E2E Testing Guide (Vision API)

`apps/ai-writer/__tests__/e2e/vision-api-pipeline.e2e.test.ts` の Vision API E2E テストを
ローカルおよび CI で実行するためのガイド。

## What runs in `pnpm test:e2e`

Anthropic Claude / OpenAI Vision API を**実 API 呼出**で叩く E2E テスト。
- 1 suite / 12 tests (provider × category × scenarios)
- Princess Cafe (Tokyo Revengers) の固定 fixture 画像を使用
- Templates v1.2 の multi-category 抽出 (menu / goods / novelty) を end-to-end で検証

`pnpm test` (default) や `.husky/pre-push` フックには**含まれない**。明示的に `pnpm test:e2e` を
実行した時のみ走る。

## Setup (Local)

### 1. テンプレートをコピー

```bash
cd apps/ai-writer
cp .env.test.local.example .env.test.local
```

### 2. 本物の API キーを記入

`.env.test.local` を編集:

```bash
# Anthropic Claude API key (sk-ant-...)
ANTHROPIC_API_KEY=sk-ant-api03-...your-real-key...

# OpenAI API key (sk-... or sk-proj-...)
OPENAI_API_KEY=sk-proj-...your-real-key...
```

`.env.test.local` は `.gitignore` の `.env*.local` パターンで除外されるためコミットされない。

### 3. E2E 実行

```bash
cd apps/ai-writer
pnpm test:e2e
```

成功時の出力例:
```text
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
```

## Cost (2026-01 pricing)

| Provider | Cost / run (3 categories) |
|---|---|
| Anthropic Claude Sonnet 4.5 | ~$0.03 |
| OpenAI gpt-4o-mini (detail=low) | ~$0.001 |

**`pnpm test:e2e` は意図的に手動実行する設計**:
- `pnpm test` (default) は E2E を除外 → 普通の開発で課金されない
- `.husky/pre-push` も E2E を除外 → push のたびに課金されない
- Stop hook (`.claude/hooks/run-tests-on-stop.sh`) は `--findRelatedTests` のみ → 通常の編集で課金されない

E2E をデバッグしたい時、または PR 直前の最終確認時にだけ叩く。

## Skip behavior

`.env.test.local` が未作成 or キーが空の場合、対応する provider のテストは
`it.skip` でスキップされる:

```text
Tests:       0 passed, 4 skipped (claude E2E)
              0 passed, 4 skipped (openai E2E)
```

→ **401 invalid x-api-key 等の API エラーは出ない** (本ガイドの設計目的)

## CI behavior

CI Job 3 (`.github/workflows/ci.yml`) は `secrets.ANTHROPIC_API_KEY` /
`secrets.OPENAI_API_KEY` を workflow の `env:` で `process.env` に**直接注入**する。
そのため CI runner に `.env.test.local` ファイルが存在しなくても問題ない。

Next.js の env 読込順は `process.env > .env.test.local > .env.test > .env` で、
CI では `process.env` がすでに real key を持つため、後続の `.env.test` (dummy 無し) や
`.env.test.local` (CI に存在しない) が処理されても上書きされない (earlier wins)。

## `ANTHROPIC_API_KEY_VISION` について

`.env.local` に `ANTHROPIC_API_KEY_VISION` を独立変数として設定しているケースがあるが、
**現在のコードベースでは未使用**:

- `apps/ai-writer/lib/services/vision-api/claude-vision.service.ts:55` は
  `process.env.ANTHROPIC_API_KEY` のみ参照
- 全ての汎用 LLM 呼出 (article-generation 等) も `ANTHROPIC_API_KEY` を共用
- `.env.example` `.env.sample` にも記載なし
- `grep -r ANTHROPIC_API_KEY_VISION` で実装側 0 hit

混乱と誤コミットリスクを避けるため、**`.env.local` から `ANTHROPIC_API_KEY_VISION` 行の削除を推奨**。

将来 Vision API 用に課金口座 / レート制限を分離したい等のユースケースが出た場合は、
`claude-vision.service.ts` のフォールバックチェーンを拡張する別タスクとして扱う。

## Troubleshooting

| 症状 | 原因 | 対処 |
|---|---|---|
| `pnpm test:e2e` で 401 invalid x-api-key | `.env.test.local` のキーが無効 / 期限切れ / typo | Anthropic console / OpenAI console で再発行、`.env.test.local` を更新 |
| 全テスト skip される | `.env.test.local` 未作成 or 値が空 | Setup 手順を再確認 |
| `pnpm test` (default) で E2E が走ってしまう | jest scripts の `--testPathIgnorePatterns` が効いていない | `apps/ai-writer/package.json` の scripts を確認 (`/__tests__/e2e/` でアンカリングされているか) |
| ローカル `.env.local` の本物キーが反映されない | Next.js 仕様で `NODE_ENV=test` 時は `.env.local` を意図的にスキップ | `.env.test.local` に同じキーを記入する (テスト用ローカル env の正規ファイル) |
| CI で E2E が skip される | GitHub Repo Settings の Secrets が未設定 | `Settings > Secrets and variables > Actions` で `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` を登録 |

## 関連

- `__tests__/e2e/vision-api-pipeline.e2e.test.ts` — テスト本体
- `jest.config.mjs` — Jest 設定 (next/jest 経由で env auto-load)
- `jest.setup.mjs` — テスト前セットアップ (グローバル mock)
- `.gitignore` (root) — `.env*.local` の除外パターン
- `.github/workflows/ci.yml` — CI Job 3 (Test) で E2E 実行
- [Next.js Environment Variables docs](https://nextjs.org/docs/pages/guides/environment-variables)
