---
title: 現行版 技術スタック
---

> Revolution は MDX パイプライン + Next.js 16 + Supabase で構成される技術スタック。WordPress 時代の構成は PR #212 で物理削除済 (Git 履歴で参照可能)。
>
> バージョンはメジャーまで書く。細かい版は Renovate で頻繁に上がるため、各 `package.json` / `pnpm-lock.yaml` / `.tool-versions` を正とする。

## フロントエンドアプリケーション

| コンポーネント | 技術 | バージョン | 用途 |
|-----------|-----------|----------|---------|
| **メインフロントエンド** (`apps/frontend`) | Next.js / React / TypeScript | 16 / 19 / 5 | 公開 Web サイトと会員機能。SSG + ISR |
| **AI Writer** (`apps/ai-writer`) | Next.js / React / TypeScript | 16 / 19 / 5 | 記事生成パイプラインと管理画面 |
| **ドキュメントサイト** (`apps/docs`) | Next.js / Fumadocs | 16 / 16 | `docs/` 直下の配信 (検索エンジン非掲載) |
| **スタイリング** | Tailwind CSS | 3 (frontend / ai-writer) / 4 (docs) | UI デザイン |
| **MDX** | next-mdx-remote | 6 | 記事の描画 |
| **データ取得** | SWR | 2 | クライアントのデータフェッチング |
| **スキーマ** | Zod | 4 | 入出力の検証 (`shared/schemas`)。frontend の環境変数は `@t3-oss/env-nextjs` |

## バックエンド & インフラストラクチャ

| コンポーネント | 技術 | 詳細 |
|-----------|-----------|---------|
| **ホスティング** | Vercel | メインフロントエンドとドキュメントサイト。Git 連携でデプロイ (main = Production / PR = Preview) |
| **データベース / 認証** | Supabase (Postgres + Auth + RLS) | 構造化データと会員機能。production / staging の 2 プロジェクト |
| **ORM / migration** | Drizzle ORM / drizzle-kit | テーブル定義は `shared/schemas/db/`、migration は `apps/frontend/supabase/migrations/` |
| **コンテナ** | Docker / Cloud Run | AI Writer の実行環境。マルチステージビルド。GitHub Actions から Artifact Registry 経由でデプロイ (Workload Identity Federation) |
| **AI Writer の認証** | Firebase Authentication | 管理画面の Google ログイン。認可は環境変数のメールアドレス allowlist |
| **AI Writer の状態** | Firestore | RSS フィードの登録 / 重複判定 / ステータス |
| **画像** | Cloudflare R2 | 記事の画像の保管と配信 (S3 互換 API) |
| **シークレット** | GCP Secret Manager | Cloud Run への注入と実行時の取得 |
| **エラー監視** | Sentry | ai-writer と frontend の 2 project ([`sentry.md`](./sentry.md)) |
| **通知** | Slack (bot token + `chat.postMessage`) | GitHub Actions と AI Writer から ([`slack-notifications.md`](./slack-notifications.md)) |

## 生成 AI & 統合 & 自動化

| サービス | 用途 | パッケージ |
|---------|---------|---------|
| **Claude API** | 記事生成 / 画像からの抽出 | `@anthropic-ai/sdk` |
| **OpenAI API** (ChatGPT) | 記事生成 / 画像からの抽出 | `openai` |
| **Gemini API** | 記事生成 / 画像からの抽出 | `@google/genai` |
| **RSS Parser** | フィード収集 | `rss-parser` |
| **Article Extractor** | URL コンテンツ抽出 | `@extractus/article-extractor` |
| **HTML パーサー** | ページの解析 | `cheerio` |
| **GitHub API** | MDX の commit と PR 作成 | `@octokit/rest` |
| **R2 クライアント** | 画像のアップロード | `@aws-sdk/client-s3` |
| **Secret Manager** | シークレット取得 | `@google-cloud/secret-manager` |

本文の生成と画像からの抽出は、それぞれ環境変数でプロバイダーを切り替える (Claude / OpenAI / Gemini)。

> Grok API は将来候補として検討対象に挙がっていますが、現時点で `apps/ai-writer/package.json` には含まれていません。

## 開発ツール

| ツール | バージョン | 用途 |
|------|---------|---------|
| **Node.js** | 24 | ランタイム (`.tool-versions`) |
| **pnpm** | 12 | パッケージマネージャー (`package.json` の `packageManager`) |
| **Turborepo** | 2 | モノレポビルドシステム |
| **Jest** | 30 | ユニットテスト |
| **Playwright** | 1 | frontend の E2E |
| **Firebase Emulator** | Latest | AI Writer のローカル認証 / Firestore テスト |
| **ESLint + Prettier** | 9 / 3 | コード品質 |
| **Husky** | 9 | Git hooks (pre-commit で gitleaks、pre-push で関連テスト) |
| **GitHub Actions** | — | CI / Cloud Run のデプロイ / Supabase の migration / 監視と通知 |

## LLM CLI

| ツール | バージョン | 開発元 |
|------|---------|---------|
| **Claude Code** | Latest | Anthropic |
| **Codex** | Latest | OpenAI |
| **Gemini CLI** | Latest | Google |
| **MCP Server Tools** | Latest | Various |

---

## 関連ドキュメント

- [プロジェクト概要・構成](./overview.md)
- [MDX パイプライン (概要)](../apps/ai-writer/README.md)
- [モノレポ構成](./monorepo.md)
- [ビルド・開発コマンド](./build.md)
