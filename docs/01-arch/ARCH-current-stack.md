# 現行版 技術スタック

> Revolution の現行版（MDX パイプライン / Next.js 16 / WordPress 削除済み）の技術スタック詳細。
> WordPress 時代を含む歴史的経緯は [`ARCH-project-overview.md`](./ARCH-project-overview.md) を参照してください。

## フロントエンドアプリケーション

| コンポーネント | 技術 | バージョン | 用途 |
|-----------|-----------|----------|---------|
| **メインフロントエンド** | Next.js / React / TypeScript | 16.1.1 / 19 / 5 | 公開 Web サイト |
| **AI Writer** | Next.js / React / TypeScript | 16.1.1 / 19 / 5 | コンテンツ生成管理画面 |
| **スタイリング** | Tailwind CSS | Latest | UI デザイン |
| **状態管理** | SWR | 2.2+ | データフェッチング |

## バックエンド & インフラストラクチャ

| コンポーネント | 技術 | 詳細 |
|-----------|-----------|---------|
| **コンテナ** | Docker / Cloud Run | マルチステージビルド |
| **認証** | Firebase Authentication | 認可用カスタムクレーム |
| **CDN** | CloudFlare | 静的アセット配信 |

## 生成 AI & 統合 & 自動化

| サービス | 用途 | パッケージ |
|---------|---------|---------|
| **Claude API** | 記事生成 | `@anthropic-ai/sdk` |
| **OpenAI API** (ChatGPT) | 記事生成 | `openai` |
| **Gemini API** | 記事生成 | `@google/generative-ai` |
| **RSS Parser** | フィード収集 | `rss-parser` |
| **Article Extractor** | URL コンテンツ抽出 | `@extractus/article-extractor` |
| **Secret Manager** | シークレット取得 | `@google-cloud/secret-manager` |

> Grok API は将来候補として検討対象に挙がっていますが、現時点で `apps/ai-writer/package.json` には含まれていません。

## 開発ツール

| ツール | バージョン | 用途 |
|------|---------|---------|
| **pnpm** | 10.11.0+ | 高速パッケージマネージャー |
| **Turbo** | 2.5+ | モノレポビルドシステム |
| **Jest** | 30.2+ | ユニットテスト |
| **Firebase Emulator** | Latest | ローカル認証 / DB テスト |
| **ESLint + Prettier** | Latest | コード品質 |

## LLM CLI

| ツール | バージョン | 開発元 |
|------|---------|---------|
| **Claude Code** | Latest | Anthropic |
| **Codex** | Latest | OpenAI |
| **Gemini CLI** | Latest | Google |
| **MCP Server Tools** | Latest | Various |

---

## 関連ドキュメント

- [MDX パイプライン詳細](./ARCH-mdx-pipeline.md)
- [プロジェクト全体アーキテクチャ（歴史的経緯）](./ARCH-project-overview.md)
- [ビルド・開発コマンド](../07-build/BUILD-commands.md)
