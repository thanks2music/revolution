# Revolution

> **Languages**: [🇯🇵 日本語](README.md) | [🇬🇧 English](README.en.md)

![License](https://img.shields.io/badge/license-Personal%20Project-blue)

---

## 📑 目次

- [概要](#-概要)
- [主要機能](#-主要機能)
- [クイックスタート](#-クイックスタート)
- [アーキテクチャ](#️-アーキテクチャ)
- [技術スタック](#️-技術スタック)
- [プロジェクト構造](#-プロジェクト構造)
- [開発](#-開発)
- [デプロイ](#-デプロイ)
- [トラブルシューティング](#️-トラブルシューティング)

---

## 📖 概要

**Revolution**は、AI記事生成機能を備えたモダンなJamstack構成の次世代Webメディアシステムを個人開発で挑戦するソロプロジェクトです。

---

## ✨ 主要機能

- 🤖 **AIコンテンツパイプライン**: RSS収集 → Claude API記事生成 → WordPress自動投稿 (DBレスに変更予定)
- ⚡ **ヘッドレスCMS**: WordPress GraphQL API と Next.js SSG/ISR
- ☁️ **クラウドネイティブ**: Google Cloud Run上のコンテナ化WordPress
- 🔐 **セキュア**: Firebase認証とカスタムクレーム
- 🧪 **テストカバレッジ**: Jest + Firebase Emulator による包括的なユニットテスト
- 📊 **モノレポ**: pnpm + Turbo による効率的なワークスペース管理

---

## 🚀 クイックスタート

### 前提条件

- **Node.js**: 20.0.0以上
- **pnpm**: 10.0.0以上
- **Docker**: ローカルWordPress開発用
- **Google Cloud SDK**: Cloud Runデプロイ用（オプション）

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/yourusername/revolution.git
cd revolution

# 依存関係のインストール
pnpm install

# 環境変数の設定
cp apps/ai-writer/.env.sample apps/ai-writer/.env.local
cp apps/frontend/.env.sample apps/frontend/.env.local

# 開発環境の起動（全ワークスペース）
pnpm dev
```

### 主要な環境変数

#### AI Writer (`apps/ai-writer/.env.local`)

```bash
# Firebase設定
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com

# Anthropic API
ANTHROPIC_API_KEY=your_anthropic_api_key

# WordPress GraphQLエンドポイント
NEXT_PUBLIC_WP_ENDPOINT=http://localhost:8080/graphql

# 管理者メールアドレス（カンマ区切り）
ADMIN_EMAILS=admin@example.com
```

#### Frontend (`apps/frontend/.env.local`)

```bash
# WordPress GraphQLエンドポイント
NEXT_PUBLIC_WP_ENDPOINT=http://localhost:8080/graphql

# 画像最適化
ALLOWED_IMAGE_HOST=localhost
```

詳細は各ワークスペースの `.env.sample` を参照してください。

---

## 🏗️ アーキテクチャ

### システム構成図

```mermaid
graph TB
    subgraph "ユーザー層"
        U[ユーザー]
    end

    subgraph "CDN層"
        CDN[CloudFlare CDN]
    end

    subgraph "フロントエンド層 (Vercel)"
        FE1[Next.js Frontend<br/>v14.2 / React 18]
        FE2[AI Writer App<br/>v15.5 / React 19<br/>Port 7777]
    end

    subgraph "バックエンド層 (Cloud Run)"
        WP[WordPress API<br/>PHP 8.4<br/>Port 8080]
    end

    subgraph "データ層 (GCP)"
        DB[(Cloud SQL<br/>MySQL 8.0)]
        GCS[Cloud Storage<br/>メディアファイル<br/>⚠️ Vercel Blobへ移行予定]
    end

    subgraph "AI & 認証"
        CLAUDE[Claude API]
        FB[Firebase Auth]
    end

    U --> CDN
    CDN --> FE1
    U --> FE2
    FE1 --> WP
    FE2 --> WP
    FE2 --> CLAUDE
    FE2 --> FB
    WP --> DB
    WP --> GCS

    style U fill:#e1f5fe
    style CDN fill:#b3e5fc
    style FE1 fill:#f3e5f5
    style FE2 fill:#f3e5f5
    style WP fill:#c8e6c9
    style CLAUDE fill:#fff9c4
    style DB fill:#ffe0b2
    style GCS fill:#ffe0b2
    style FB fill:#ffccbc
```

### データフロー: AI記事生成

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant AIWriter as AI Writer<br/>(Vercel)
    participant RSS as RSSパーサー
    participant Claude as Claude API
    participant WP as WordPress GraphQL<br/>(Cloud Run)
    participant GCS as Cloud Storage

    User->>AIWriter: 自動生成トリガー
    AIWriter->>RSS: RSSフィード取得
    RSS-->>AIWriter: 記事を返す
    AIWriter->>AIWriter: 記事検証<br/>(キーワード、日本語)
    AIWriter->>Claude: 記事生成<br/>(テンプレートベース)
    Claude-->>AIWriter: 生成コンテンツを返す
    AIWriter->>WP: メディアアップロード
    WP->>GCS: 画像を保存
    GCS-->>WP: URLを返す
    AIWriter->>WP: 投稿作成<br/>(GraphQL Mutation)
    WP-->>AIWriter: 投稿IDを返す
    AIWriter-->>User: 成功
```

---

## 🛠️ 技術スタック

### フロントエンドアプリケーション

| コンポーネント | 技術 | バージョン | 用途 |
|-----------|-----------|----------|---------|
| **メインフロントエンド** | Next.js / React / TypeScript | 14.2 / 18 / 5 | 公開Webサイト |
| **AI Writer** | Next.js / React / TypeScript | 15.5 / 19 / 5 | コンテンツ生成管理画面 |
| **スタイリング** | Tailwind CSS | Latest | UIデザイン |
| **状態管理** | SWR | 2.2+ | データフェッチング |

### バックエンド & インフラストラクチャ

| コンポーネント | 技術 | 詳細 |
|-----------|-----------|---------|
| **CMS** | WordPress 6.7 / PHP 8.4 | GraphQLを使用したヘッドレスモード |
| **データベース** | Cloud SQL (MySQL 8.0) | コスト最適化ティア |
| **ストレージ** | Cloud Storage | 公開メディアファイル（Vercel Blob移行予定） |
| **コンテナ** | Docker / Cloud Run | マルチステージビルド |
| **認証** | Firebase Authentication | 認可用カスタムクレーム |
| **CDN** | CloudFlare | 静的アセット配信 |

### AI & 統合

| サービス | 用途 | パッケージ |
|---------|---------|---------|
| **Claude API** | 記事生成 | `@anthropic-ai/sdk` |
| **Grok API** | Coming soon | `TRD` |
| **RSS Parser** | フィード収集 | `rss-parser` |
| **Article Extractor** | URLコンテンツ抽出 | `@extractus/article-extractor` |
| **GraphQL Codegen** | 型安全なWordPress API | `@graphql-codegen/*` |

### 開発ツール

| ツール | バージョン | 用途 |
|------|---------|---------|
| **pnpm** | 10.11.0+ | 高速パッケージマネージャー |
| **Turbo** | 2.5+ | モノレポビルドシステム |
| **Jest** | 30.2+ | ユニットテスト |
| **Firebase Emulator** | Latest | ローカル認証/DBテスト |
| **ESLint + Prettier** | Latest | コード品質 |

### LLM for Coding

| ツール | バージョン | 開発元 |
|------|---------|---------|
| **Claude Code** | Latest | Anthropic |
| **Codex** | Latest | OpenAI |
| **Gemini CLI** | Latest | Google |
| **MCP Server Tools** | Latest | Various |

---

## 📁 プロジェクト構造

```
revolution/
├── apps/
│   ├── ai-writer/              # AIコンテンツ生成管理アプリ (Next.js 15.5)
│   ├── backend/                # WordPressヘッドレスCMS (Cloud Run)
│   ├── frontend/               # メインNext.js Webサイト (Next.js 14.2)
│   └── mcp-gcp-server/         # Model Context Protocolサーバー
│
├── docs/                       # 公開用ドキュメント
│   └── {number}-{genre}/       # Frontend, Backend, Infra, CI/CD, LLM...etc
│
├── shared/                     # ワークスペース間で共有されるコード
│   ├── types/                  # 共通TypeScript型定義
│   └── utils/                  # ユーティリティ関数
│
├── scripts/                    # 自動化スクリプト
│   ├── sync-docs-to-icloud.sh  # ドキュメント同期
│   └── create-doc-and-sync.sh  # ドキュメント作成ヘルパー
│
├── package.json                # ルートパッケージ設定
├── pnpm-workspace.yaml         # ワークスペース設定
└── turbo.json                  # Turboキャッシュ設定
```

---

## 💻 開発

### ルートレベル（モノレポ）

```bash
# 開発サーバー起動（全ワークスペース）
pnpm dev

# 特定のワークスペースのみ起動
pnpm dev:frontend     # フロントエンドのみ
pnpm dev:ai-writer    # AI Writerのみ

# ビルド
pnpm build            # 全ワークスペース
pnpm build:frontend   # フロントエンドのみ

# テスト & 品質チェック
pnpm test             # 全テストを実行
pnpm lint             # 全ワークスペースをLint
pnpm type-check       # TypeScript検証

# クリーンアップ
pnpm clean            # ビルド成果物を削除
pnpm fresh            # クリーンインストール
```

### AI Writer アプリ

```bash
cd apps/ai-writer

# 開発
pnpm dev              # ポート7777で起動
pnpm restart          # 強制終了&再起動

# テスト
pnpm test             # Jestテストを実行
pnpm test:watch       # ウォッチモード
pnpm test:coverage    # カバレッジレポート

# GraphQLコード生成
pnpm codegen          # スキーマから型を生成

# Firebase管理者
pnpm admin:setup      # 管理者ユーザーをセットアップ
pnpm admin:list       # 管理者をリスト表示
```

### バックエンド（WordPress）

```bash
cd apps/backend

# ローカル開発
docker-compose up -d          # コンテナを起動
docker-compose logs -f        # ログを表示
docker-compose down           # コンテナを停止

# デプロイ
./scripts/deploy.sh           # Cloud Runへデプロイ
```

詳細な開発ガイド: [docs/06-ops/](docs/06-ops/)

---

## 🚢 デプロイ

### フロントエンド（Vercel）

```bash
cd apps/frontend
vercel --prod

# またはルートから
pnpm deploy:frontend
```

### バックエンド（Cloud Run）

```bash
cd apps/backend
./scripts/deploy.sh

# またはルートから
pnpm deploy:backend
```

**⚠️ 重要**: リポジトリルートの `scripts/deploy.sh` は未完成です。必ず `apps/backend/scripts/deploy.sh` を使用してください。

### AI Writer（Vercel）

```bash
cd apps/ai-writer
./scripts/deploy.sh
```

詳細なデプロイガイド: [docs/08-cicd/](docs/08-cicd/)

---

## ⚠️ トラブルシューティング

### 開発サーバーが起動しない

**症状**: `pnpm dev` でエラーが発生

**解決策**:
1. Node.jsバージョン確認: `node --version` (20.0.0以上が必要)
2. 依存関係の再インストール: `pnpm fresh`
3. ポート競合確認: `lsof -i :7777` (AI Writer) / `lsof -i :3000` (Frontend)
4. 強制終了後に再起動: `pnpm restart`

### WordPress GraphQLエンドポイントに接続できない

**症状**: `Failed to fetch from WordPress GraphQL`

**解決策**:
1. WordPressコンテナが起動中か確認:
   ```bash
   docker ps | grep wordpress
   ```

2. GraphQLエンドポイントをテスト:
   ```bash
   curl -X POST http://localhost:8080/graphql \
     -H "Content-Type: application/json" \
     -d '{"query": "{ posts { edges { node { title } } } }"}'
   ```

3. 環境変数を確認:
   ```bash
   # apps/ai-writer/.env.local または apps/frontend/.env.local
   NEXT_PUBLIC_WP_ENDPOINT=http://localhost:8080/graphql
   ```

### Firebase認証エラー

**症状**: `Firebase: Error (auth/invalid-api-key)`

**解決策**:
1. Firebase設定を確認: `apps/ai-writer/.env.local`
2. Firebase Admin SDKの環境変数を確認:
   ```bash
   FIREBASE_PROJECT_ID=your_project_id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your_project.iam.gserviceaccount.com
   ```
3. 管理者セットアップ: `cd apps/ai-writer && pnpm admin:setup`

### ポート8080の競合

**症状**: `Error: listen EADDRINUSE: address already in use :::8080`

**解決策**:
```bash
# 使用中のプロセスを確認
lsof -i :8080

# プロセスを終了
kill -9 <PID>

# またはDockerコンテナを停止
docker-compose down
```

### 本番環境でのデバッグログ

**セキュリティ注意**: 本番デプロイ前にデバッグログを削除してください:

```typescript
// apps/ai-writer/lib/firebase/admin.ts
// ❌ 本番環境では削除
console.log('[Firebase Admin] Project ID:', process.env.FIREBASE_PROJECT_ID);
```

詳細なトラブルシューティング: [docs/06-ops/OPS-troubleshooting.md](docs/06-ops/)

---

## 開発ワークフロー

1. フィーチャーブランチを作成: `git checkout -b feature/your-feature-name`
2. コンベンショナルコミットで変更: `git commit -m "feat: add new feature"`
3. テストを実行: `pnpm test`
4. `main`へプルリクエストを作成

### コミット規約

```bash
✨ feat:      新機能追加
🐛 fix:       バグ修正
📝 docs:      ドキュメント
🔧 config:    設定変更
♻️  refactor:  コードリファクタリング
🧪 test:      テスト追加
🎨 style:     コードフォーマット
⚡️ perf:      パフォーマンス改善
```

---

## 🙏 謝辞

以下を使用して構築:

- [Next.js](https://nextjs.org/) - Reactフレームワーク
- [WordPress](https://wordpress.org/) - CMS
- [WPGraphQL](https://www.wpgraphql.com/) - WordPress用GraphQL
- [Anthropic Claude](https://www.anthropic.com/) - AI API
- [Firebase](https://firebase.google.com/) - 認証
- [Google Cloud](https://cloud.google.com/) - インフラストラクチャ
- [Vercel](https://vercel.com/) - デプロイメントプラットフォーム

---

**Happy Coding! 🚀**
