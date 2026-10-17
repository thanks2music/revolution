---
title: ビルド & 開発コマンド
---

Revolution は pnpm workspaces + Turborepo を採用しており、ルートから `pnpm <command>` で workspace 全体を統括できます。

## 主要コマンド

| コマンド | 説明 |
|---|---|
| `pnpm dev` | Frontend と AI Writer を並列起動 |
| `pnpm dev:frontend` | Frontend のみ起動 |
| `pnpm dev:ai-writer` | AI Writer のみ起動 |
| `pnpm dev:docs` | ドキュメントサイト (`apps/docs`) のみ起動 (http://localhost:3333) |
| `pnpm build` | Frontend と AI Writer を並列ビルド |
| `pnpm build:docs` | ドキュメントサイトをビルド (`docs/` 直下の frontmatter の抜けもここで落ちる) |
| `pnpm lint` | ESLint 全 workspace |
| `pnpm type-check` | TypeScript 型チェック (strict mode) |
| `pnpm test` | Jest テスト全 workspace (Layer 1/2、E2E は別) |
| `pnpm --filter @revolution/ai-writer test:e2e` | Layer 3 E2E (Vision API 実 key 必要、AI Writer 配下のみ、PR #217 で分離) |

## 個別 workspace へのコマンド送出

```bash
# AI Writer のみ test
pnpm --filter @revolution/ai-writer test

# Frontend のみ build
pnpm --filter frontend-nextjs-headless-cms build

# AI Writer の Vision API 動作確認 (実 key 必要)
pnpm --filter @revolution/ai-writer debug:vision
```

## デプロイ

| 対象 | コマンド |
|---|---|
| Frontend (Vercel) | `pnpm deploy:frontend` |
| AI Writer (Cloud Run) | GitHub Actions 自動デプロイ ([`ai-writer-cloud-run.md`](./ai-writer-cloud-run.md)) |
| ドキュメントサイト (Vercel) | main へのマージで自動デプロイ (Vercel プロジェクト `revolution-phoenix-docs`、Root Directory `apps/docs`) |

## ドキュメント関連

| コマンド | 説明 |
|---|---|
| `pnpm docs:sync` | docs/ を iCloud に同期 (iPad 閲覧用) |
| `pnpm docs:create` | ドキュメント作成 + 同期ヘルパー |

## 環境セットアップ

pnpm は `package.json` の `packageManager` で 12 系に固定しています。pnpm 11 以上が入っていれば固定の版へ自動で切り替わります。pnpm 10 からは切り替えられないので、pnpm 11 以上にするか `corepack enable` を使ってください。

```bash
pnpm install              # 依存関係インストール
pnpm sync:templates       # private templates リポジトリから YAML 同期
cp .env.sample .env.local  # 環境変数テンプレート (SSOT、要 API key 設定)
```

## キャッシュクリア

```bash
pnpm clean                # turbo cache + dist 削除
pnpm fresh                # clean + install (依存関係再構築)
```
