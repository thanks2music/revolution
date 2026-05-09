# ビルド & 開発コマンド

Revolution は pnpm workspaces + Turborepo を採用しており、ルートから `pnpm <command>` で workspace 全体を統括できます。

## 主要コマンド

| コマンド | 説明 |
|---|---|
| `pnpm dev` | Frontend と AI Writer を並列起動 |
| `pnpm dev:frontend` | Frontend のみ起動 |
| `pnpm dev:ai-writer` | AI Writer のみ起動 |
| `pnpm build` | Frontend と AI Writer を並列ビルド |
| `pnpm lint` | ESLint 全 workspace |
| `pnpm type-check` | TypeScript 型チェック (strict mode) |
| `pnpm test` | Jest テスト全 workspace (Layer 1/2、E2E は別) |
| `pnpm test:e2e` | Layer 3 E2E (Vision API 実 key 必要、PR #217 で分離) |

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
| AI Writer (Cloud Run) | GitHub Actions 自動デプロイ ([`../operations/ai-writer-cloud-run.md`](../operations/ai-writer-cloud-run.md)) |

## ドキュメント関連

| コマンド | 説明 |
|---|---|
| `pnpm docs:sync` | docs/ を iCloud に同期 (iPad 閲覧用) |
| `pnpm docs:create` | ドキュメント作成 + 同期ヘルパー |

## 環境セットアップ

```bash
pnpm install              # 依存関係インストール
pnpm sync:templates       # private templates リポジトリから YAML 同期
cp .env.example .env.local  # 環境変数テンプレート (要 API key 設定)
```

## キャッシュクリア

```bash
pnpm clean                # turbo cache + dist 削除
pnpm fresh                # clean + install (依存関係再構築)
```
