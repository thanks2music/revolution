<p align="center">
  <a href="https://github.com/thanks2music/revolution">
    <img src="apps/frontend/public/images/og-image-compressed.png" width="100%" alt="Revolution">
  </a>
</p>

# Revolution

> **Languages**: [🇬🇧 English](README.md) | [🇯🇵 日本語](README.ja.md)

**Step by step. Commit by commit. The destination shows up in `git log`.**

> "Step by step, I can't see any other way of accomplishing anything."<br>
> — Michael Jordan

![License: Personal Project](https://img.shields.io/badge/license-Personal%20Project-blue)
![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![pnpm 12](https://img.shields.io/badge/pnpm-12-f69220?logo=pnpm&logoColor=white)
![Turborepo 2](https://img.shields.io/badge/Turborepo-2-ef4444?logo=turborepo&logoColor=white)

LLM を活用した AI 記事生成パイプラインを備えた、Jamstack 構成の次世代 Web メディアシステムのリポジトリ。[@thanks2music](https://github.com/thanks2music) が個人開発で取り組むモダン Web アプリケーションの実験場です。

## What is Revolution?

これまで手動で 1 万記事以上を作成してきた知見を、LLM とモジュール化された YAML テンプレートに落とし込んでいます。AI Writer が RSS フィードや URL から MDX の記事を作って GitHub に PR を出し、PR がマージされると Vercel がサイトをビルドして公開します。

- **記事** はこのリポジトリの MDX ファイルです (記事用のデータベースはありません)。Next.js の静的サイト生成 (SSG) と ISR で配信します
- **構造化データと会員機能** (アカウント・お気に入り) は Supabase (Postgres + Auth) にあります
- **プロンプトとテンプレート** は別の private リポジトリにあります

## Documentation

| Topic | Link |
|---|---|
| 全ドキュメント一覧 + ナビゲーション | [`docs/README.md`](./docs/README.md) |
| プロジェクト概要・構成 | [`docs/overview.md`](./docs/overview.md) |
| 現行版 技術スタック | [`docs/current-stack.md`](./docs/current-stack.md) |
| AI Writer の MDX パイプライン (概要) | [`apps/ai-writer/README.md`](./apps/ai-writer/README.md) |
| モノレポ運用 (pnpm + Turborepo) | [`docs/monorepo.md`](./docs/monorepo.md) |
| 開発・ビルドコマンド | [`docs/build.md`](./docs/build.md) |
| AI Writer Cloud Run デプロイ | [`docs/ai-writer-cloud-run.md`](./docs/ai-writer-cloud-run.md) |

`docs/` 直下のドキュメントは、`apps/docs` で作るドキュメントサイトでもページとして読めます (検索エンジンには載せていません)。

## Quick Start

前提: Node.js 24 ([`.tool-versions`](./.tool-versions) で固定) と pnpm 12 ([`package.json`](./package.json) の `packageManager` で固定)。

```bash
# リポジトリのクローン
git clone https://github.com/thanks2music/revolution.git
cd revolution

# 依存関係のインストール
pnpm install

# 環境変数の設定
cp apps/ai-writer/.env.sample apps/ai-writer/.env.local
cp apps/frontend/.env.sample apps/frontend/.env.local

# 開発サーバーの起動（ルートから一括）
pnpm dev                      # フロントエンド (http://localhost:4444) + AI Writer (http://localhost:7777) を並行起動

# 個別起動も可能
pnpm dev:frontend             # 公開フロントエンドのみ
pnpm dev:ai-writer            # AI Writer のみ
pnpm dev:docs                 # ドキュメントサイトのみ (http://localhost:3333)
```

> 💡 複数 worktree で同時に dev サーバーを動かす場合は port 衝突を避けるため、`bash scripts/worktree-dev.sh frontend` / `bash scripts/worktree-dev.sh ai-writer` / `bash scripts/worktree-dev.sh docs` を使ってください。`pnpm dev` は常にデフォルト port (4444 / 7777) で起動します。

記事の生成には、LLM の API キーと、private リポジトリのテンプレート (`pnpm sync:templates` でコピー) も要ります。clone しただけではパイプラインは最後まで動きません。

詳細は [`docs/build.md`](./docs/build.md) を参照してください。

## Tech Stack

- **Frontend**: Next.js 16 / React 19 / TypeScript 5 / Tailwind CSS / SWR / next-mdx-remote。Vercel で配信 (SSG + ISR)
- **Data & Auth**: Supabase (Postgres + Auth) / Drizzle ORM / Zod スキーマ (`shared/schemas` で共有)
- **AI Writer**: Next.js 16 を Google Cloud Run で実行 / Claude (Anthropic) ・ Gemini (Google) ・ OpenAI (環境変数で切替) / Firebase (Auth + Firestore) を管理画面とパイプラインの状態管理に使用
- **Storage**: Cloudflare R2 (記事の画像)
- **Docs site**: Next.js 16 / Fumadocs。Vercel で配信
- **Observability**: Sentry / Slack 通知
- **Tooling**: pnpm 12 / Turborepo 2 / Jest 30 / Playwright / ESLint 9 / Prettier 3 / Husky 9

詳細表は [`docs/current-stack.md`](./docs/current-stack.md) にあります。

## Development tooling

### Git hooks (Husky)

- **pre-commit**: ステージしたファイルを [gitleaks](https://github.com/gitleaks/gitleaks) でシークレットスキャンします (gitleaks が無い環境ではメッセージを出してスキップ)
- **pre-push**: 変更した TS/TSX/JS ファイルに関連する `apps/ai-writer` の Jest テストを実行します (約 30-60 秒)
- 緊急時の skip: `HUSKY=0 git push`。それ以外は失敗を直してから push し直してください (silent failure を防ぐゲートのため)

フックのスクリプトは [`.husky/`](./.husky/) にあります。

## Project Structure

```text
revolution/
├── apps/
│   ├── ai-writer/       # AI 記事生成パイプライン + 管理画面（Next.js 16、Cloud Run）
│   ├── docs/            # ドキュメントサイト（Next.js 16 / Fumadocs）
│   ├── frontend/        # 公開 Web サイト（Next.js 16、Vercel）+ Supabase の migration
│   └── mcp-gcp-server/  # Model Context Protocol サーバー
├── docs/                # 公開ドキュメント
├── shared/
│   └── schemas/         # Zod スキーマと Drizzle のテーブル定義（ワークスペース共通）
├── scripts/             # 自動化スクリプト
└── .github/workflows/   # CI/CD パイプライン
```

## Acknowledgments

[Next.js](https://nextjs.org/) ・ [Anthropic Claude](https://www.anthropic.com/) ・ [Supabase](https://supabase.com/) ・ [Vercel](https://vercel.com/) ・ [Google Cloud](https://cloud.google.com/) ・ [Firebase](https://firebase.google.com/) を使用して構築。

---

**Happy Coding! 🚀**
