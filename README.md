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

**Revolution**は、[@thanks2music](https://github.com/thanks2music)が個人開発で取り組む、LLMを活用したAI記事生成機能を備えた Jamstack構成の次世代Webメディアシステムです。
これまで手動で1万記事以上を作成してきた経験をもとに、その知見をAIと組み合わせることで、記事制作から公開までを自動化するモダンな Web アプリケーションの構築に挑戦しています。

---

## ✨ 主要機能

### MDX ベース記事生成システム（現行版）

- 🤖 **AI 記事生成パイプライン**: RSS/URL → Nステップパイプライン → MDX ファイル → GitHub PR
- 🔄 **マルチ AI プロバイダー**: 環境変数で切り替え可能
  - Claude (Anthropic) - デフォルト
  - Gemini (Google)
  - OpenAI (GPT)

- 📝 **YAML テンプレートシステム**: [@thanks2music](https://github.com/thanks2music)の暗黙知をモジュール化したYAMLでプロンプト管理
- ⚡ **静的サイト生成（SSG）最適化**:
  - MDX による DBレス アーキテクチャ
  - `article-index.json` による高速記事検索
  - Vercel へのシームレスなデプロイ

- 🔐 **セキュア認証**: Firebase Authentication + カスタムクレーム
- 🧪 **テストカバレッジ**: Jest + Firebase Emulator による包括的テスト
- 📊 **モノレポ管理**: pnpm + Turbo による効率的なワークスペース管理

### 🗂️ Legacy Headless CMS Architecture

- 🤖 **AIコンテンツパイプライン**: RSS収集 → Claude, ChatGPT, Gemini API記事生成(Phase0.1), Grok → LLM(Claude, ChatGPT, Gemini)記事生成(Phase1)
  - Phase 0.1 以降は 「MDX 専用」とする。
- ⚡ **ヘッドレスCMS**: WordPress GraphQL API と Next.js SSG/ISR
  - 「Headless WordPress」は、 git tag: `headless-wp-mvp-final-20251103` まで。レガシー版として開発中止。
  - 「Headless WordPress 版を復旧したい場合は、上記タグを参照」
- ☁️ **クラウドネイティブ**: Google Cloud Run上のコンテナ化WordPress

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

### MDX パイプライン アーキテクチャ（現行版）

現在の AI Writer は **MDX ベースの記事生成パイプライン** を使用しています。

#### パイプライン概要図

```mermaid
flowchart TB
    subgraph Input["📥 入力"]
        RSS[("RSS フィード")]
        URL["記事 URL"]
    end

    subgraph Pipeline["🔄 MDX パイプライン (9 Steps)"]
        direction TB
        S0["Step 0.5<br/>記事選別"]
        S1["Step 1<br/>情報抽出"]
        S2["Step 2<br/>Slug 解決"]
        S3["Step 3<br/>重複チェック"]
        S4["Step 4<br/>メタデータ生成"]
        S45["Step 4.5<br/>タイトル生成"]
        S5["Step 5<br/>MDX 生成"]
        S6["Step 6<br/>GitHub PR 作成"]
        S7["Step 7<br/>ステータス更新"]

        S0 --> S1 --> S2 --> S3 --> S4 --> S45 --> S5 --> S6 --> S7
    end

    subgraph External["🌐 外部サービス"]
        AI["AI Provider<br/>(Claude/Gemini/OpenAI)"]
        FS[("Firestore<br/>イベント管理")]
        GH["GitHub API<br/>PR 作成"]
        YAML["YAML テンプレート<br/>(モジュール化)"]
    end

    subgraph Output["📤 出力"]
        MDX["MDX ファイル"]
        PR["GitHub PR"]
    end

    RSS --> S0
    URL --> S0
    S0 <--> AI
    S1 <--> AI
    S2 <--> YAML
    S3 <--> FS
    S4 <--> AI
    S45 <--> AI
    S45 <--> YAML
    S6 --> GH
    S7 --> FS
    S5 --> MDX
    S6 --> PR

    style S0 fill:#e3f2fd
    style S1 fill:#e3f2fd
    style S4 fill:#e3f2fd
    style S45 fill:#e3f2fd
    style AI fill:#fff9c4
    style FS fill:#ffe0b2
    style GH fill:#c8e6c9
    style YAML fill:#f3e5f5
```

#### 詳細パイプラインフロー

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant MDX as MDX Service
    participant HTML as HTML Extractor
    participant Select as ArticleSelection Service
    participant Extract as extractFromRss
    participant Slug as Slug Resolver
    participant FS as Firestore
    participant GH as GitHub API
    participant Meta as Metadata Generator
    participant TitleSvc as TitleGeneration Service
    participant AI as AI Provider (Claude/Gemini/OpenAI)
    participant YAML as YAML Template

    User->>MDX: generateMdxFromRSS(rssItem)

    Note over MDX,AI: Step 0.5 記事選別
    MDX->>HTML: 記事HTML取得
    HTML-->>MDX: articleHtml
    MDX->>Select: shouldGenerateArticle()
    Select->>YAML: loadModularTemplate('EVENT_TYPE','1-selection')
    YAML-->>Select: template
    Select->>AI: sendMessage(prompt)
    AI-->>Select: JSON response
    Select-->>MDX: should_generate, official_urls

    alt should_generate = false
        MDX-->>User: スキップ (公式URLなし)
    end

    Note over MDX,AI: Step 1 情報抽出
    MDX->>Extract: extractFromRss(rssItem)
    Extract->>AI: RSS から抽出
    AI-->>Extract: workTitle, storeName, eventTypeName
    Extract-->>MDX: extraction

    Note over MDX,Slug: Step 2 Slug 解決
    MDX->>Slug: resolveWorkSlug(workTitle)
    MDX->>Slug: resolveStoreSlug(storeName)
    MDX->>Slug: resolveEventTypeSlug(eventTypeName)
    Slug-->>MDX: workSlug, storeSlug, eventType

    Note over MDX,FS: Step 3 重複チェック & 登録
    MDX->>FS: checkEventDuplication()
    FS-->>MDX: isDuplicate, canonicalKey
    alt isDuplicate
        MDX->>GH: getPrStatusByCanonicalKey()
        GH-->>MDX: hasOpenPr
        alt hasOpenPr
            MDX-->>User: DuplicateSlugError
        else closed
            MDX->>FS: deleteEvent()
        end
    end
    MDX->>FS: registerNewEvent()
    FS-->>MDX: eventRecord

    Note over MDX,AI: Step 4 メタデータ生成
    MDX->>Meta: generateArticleMetadata()
    Meta->>AI: カテゴリ/抜粋生成
    AI-->>Meta: categories, excerpt
    Meta-->>MDX: metadata

    Note over MDX,AI: Step 4.5 タイトル生成
    MDX->>TitleSvc: generateTitle()
    TitleSvc->>YAML: loadModularTemplate('EVENT_TYPE','3-title')
    YAML-->>TitleSvc: template rules
    TitleSvc->>AI: sendMessage(prompt)
    AI-->>TitleSvc: title
    TitleSvc-->>MDX: title, length, is_valid

    Note over MDX,GH: Step 5-7 MDX生成 & PR作成
    MDX->>MDX: generateMdxArticle()
    MDX->>GH: createMdxPr()
    GH-->>MDX: prNumber, prUrl
    MDX->>FS: updateEventStatus('generated')

    MDX-->>User: success, mdxArticle, prResult
```

#### サービス依存関係図

```mermaid
graph LR
    subgraph Services["サービス層"]
        AGMS["ArticleGeneration<br/>MdxService"]
        ASS["ArticleSelection<br/>Service"]
        TGS["TitleGeneration<br/>Service"]
        YTLS["YamlTemplateLoader<br/>Service"]
    end

    subgraph AI["AI プロバイダー層"]
        AIF["AI Factory"]
        ANT["Anthropic<br/>Provider"]
        GEM["Gemini<br/>Provider"]
        OAI["OpenAI<br/>Provider"]
    end

    subgraph Data["データ層"]
        FS[("Firestore")]
        GH["GitHub API"]
        YAML[("YAML<br/>Templates")]
    end

    subgraph Utils["ユーティリティ"]
        EFR["extractFromRss"]
        GAM["generateArticle<br/>Metadata"]
        SR["Slug Resolver"]
        HE["HTML Extractor"]
    end

    AGMS --> ASS
    AGMS --> TGS
    AGMS --> EFR
    AGMS --> GAM
    AGMS --> SR
    AGMS --> HE
    AGMS --> FS
    AGMS --> GH

    ASS --> YTLS
    ASS --> AIF
    TGS --> YTLS
    TGS --> AIF

    YTLS --> YAML

    AIF --> ANT
    AIF --> GEM
    AIF --> OAI

    EFR --> AIF
    GAM --> AIF

    style AGMS fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style AIF fill:#fff9c4,stroke:#f9a825,stroke-width:2px
    style YAML fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

#### YAML テンプレート モジュール構造

```mermaid
graph TB
    subgraph Templates["templates/EVENT_TYPE/"]
        META["{META}.yaml<br/>メタ情報・順序定義"]

        subgraph Shared["shared/"]
            PH["placeholders.yaml<br/>プレースホルダー定義"]
            CONS["constraints.yaml<br/>文字数制約・バリデーション"]
        end

        subgraph Pipeline["pipeline/"]
            P1["1-selection.yaml<br/>記事選別"]
            P2["2-extraction.yaml<br/>情報抽出"]
            P3["3-title.yaml<br/>タイトル生成"]
            P4["4-content.yaml<br/>本文生成"]
        end

        subgraph Sections["sections/"]
            S1["01-example.yaml"]
            S2["02-example.yaml"]
            S3["03-example.yaml"]
            S4["..."]
        end
    end

    META --> Shared
    META --> Pipeline
    META --> Sections

    style META fill:#ffecb3
    style Shared fill:#e1f5fe
    style Pipeline fill:#f3e5f5
    style Sections fill:#c8e6c9
```

#### マルチプロバイダー切り替え

```mermaid
flowchart LR
    ENV["AI_PROVIDER<br/>環境変数"]

    subgraph Factory["AI Factory"]
        direction TB
        CREATE["createAiProvider()"]
    end

    subgraph Providers["プロバイダー"]
        ANT["🟣 Anthropic<br/>Claude"]
        GEM["🔵 Gemini<br/>Google"]
        OAI["🟢 OpenAI<br/>GPT"]
    end

    ENV --> CREATE
    CREATE --> ANT
    CREATE --> GEM
    CREATE --> OAI

    ANT -.->|"default"| CREATE

    style ANT fill:#d1c4e9
    style GEM fill:#bbdefb
    style OAI fill:#c8e6c9
```

---

### システム構成図 (レガシー版)

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
        GCS[Cloud Storage<br/>メディアファイル]
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

### データフロー: AI記事生成（レガシー: Headless WordPress版）

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

> ⚠️ **注意**: 上記は WordPress 版（レガシー）のフローです。現在は MDX パイプラインが主流です。

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

---

## 🚢 デプロイ (TODO)

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

### AI Writer（Vercel）

```bash
cd apps/ai-writer
./scripts/deploy.sh
```

---

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
