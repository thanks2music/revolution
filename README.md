<p align="center">
  <a href="https://github.com/thanks2music/revolution">
    <img src="apps/frontend/public/images/og-image-compressed.png" width="100%" alt="Revolution">
  </a>
</p>

# Revolution

> **Languages**: [🇯🇵 日本語](README.md) | [🇬🇧 English](README.en.md)

![License](https://img.shields.io/badge/license-Personal%20Project-blue)
![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![pnpm](https://img.shields.io/badge/pnpm-10-f69220?logo=pnpm)
![Turbo](https://img.shields.io/badge/Turbo-2.5-00d49a)

LLM を活用した AI 記事生成パイプラインを備えた、Jamstack 構成の次世代 Web メディアシステムのリポジトリ。[@thanks2music](https://github.com/thanks2music) が個人開発で取り組むモダン Web アプリケーションの実験場です。

## What is Revolution?

これまで手動で 1 万記事以上を作成してきた知見を、LLM とモジュール化された YAML テンプレートに落とし込み、**RSS / URL → N ステップのパイプライン → MDX ファイル → GitHub PR** という形で記事生成から公開までを自動化します。記事はデータベースを持たず、Next.js による静的サイト生成（SSG）で配信されます。

## Documentation

| Topic | Link |
|---|---|
| 全ドキュメント一覧 + ナビゲーション | [`docs/README.md`](./docs/README.md) |
| プロジェクト概要・ビジョン | [`docs/architecture/overview.md`](./docs/architecture/overview.md) |
| 現行版 技術スタック | [`docs/architecture/current-stack.md`](./docs/architecture/current-stack.md) |
| MDX パイプライン詳細 (18 step + Mermaid + drawio) | [`docs/architecture/pipeline.md`](./docs/architecture/pipeline.md) |
| モノレポ運用 (pnpm + Turborepo) | [`docs/architecture/monorepo.md`](./docs/architecture/monorepo.md) |
| 開発・ビルドコマンド | [`docs/development/build.md`](./docs/development/build.md) |
| Atomic Design コンポーネント設計 | [`docs/development/atomic-components.md`](./docs/development/atomic-components.md) |
| AI Writer Cloud Run デプロイ | [`docs/operations/ai-writer-cloud-run.md`](./docs/operations/ai-writer-cloud-run.md) |
| Claude Code 設定 | [`docs/development/claude-code-settings.md`](./docs/development/claude-code-settings.md) |

更新履歴は [GitHub Releases](https://github.com/thanks2music/revolution/releases) を参照してください。

## Quick Start

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
```

> 💡 複数 worktree で同時に dev サーバーを動かす場合は port 衝突を避けるため、`bash scripts/worktree-dev.sh frontend` / `bash scripts/worktree-dev.sh ai-writer` を使ってください。`pnpm dev` は常にデフォルト port (4444 / 7777) で起動します。

詳細は [`docs/development/build.md`](./docs/development/build.md) を参照してください。

## Tech Stack

- **Frontend**: Next.js 16 / React 19 / TypeScript 5 / Tailwind CSS / SWR
- **AI Providers**: Claude (Anthropic) ・ Gemini (Google) ・ OpenAI（環境変数で切替）
- **Infra**: Google Cloud Run / Firebase Authentication / Vercel / CloudFlare CDN
- **Tooling**: pnpm 10 / Turbo 2.5 / Jest 30 / ESLint 9 / Husky 9

詳細表は [`docs/architecture/current-stack.md`](./docs/architecture/current-stack.md) にあります。

## Development tooling

### Husky pre-push hook

`git push` 時に変更ファイル (TS/TSX/JS) に関連する jest テストを自動実行し、silent failure を未然に防ぎます。実行スコープは `apps/ai-writer` のみで、約 30-60 秒で完了する想定です。

- スクリプト本体: [`.husky/pre-push`](./.husky/pre-push)
- 緊急 skip: `HUSKY=0 git push` (緊急時のみ、原則 push 前に test を pass させてください)
- test 失敗時の対処: 失敗を修正してから再度 push (silent failure を防ぐゲートのため、bypass は推奨しません)

## Project Structure

```text
revolution/
├── apps/
│   ├── ai-writer/   # AI 記事生成管理アプリ（Next.js 16 / React 19）
│   ├── frontend/    # 公開 Web サイト（Next.js 16 / React 19）
│   └── mcp-gcp-server/  # Model Context Protocol サーバー
├── docs/            # 公開ドキュメント
├── shared/          # 型定義・ユーティリティ（ワークスペース共通）
├── scripts/         # 自動化スクリプト
└── .github/workflows/  # CI/CD パイプライン
```

## Acknowledgments

[Next.js](https://nextjs.org/) ・ [Anthropic Claude](https://www.anthropic.com/) ・ [Firebase](https://firebase.google.com/) ・ [Google Cloud](https://cloud.google.com/) ・ [Vercel](https://vercel.com/) を使用して構築。

---

**Happy Coding! 🚀**
