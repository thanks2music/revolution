# AI Writer (Discovery) - Revolution

**自動記事生成システム** - RSS フィードからアニメコラボイベント記事を生成し、GitHub PR 経由で Revolution に投稿します。

## 現行パイプライン

**MDX パイプライン** が本番運用モードです（2025年1月時点）。

### MDX Pipeline フロー

```
RSS Feed
  ↓
Claude API (workTitle/storeName/eventType 抽出)
  ↓
Firestore (重複チェック + ULID生成)
  ↓
Claude API (categories/excerpt 生成)
  ↓
MDX Article 生成 (frontmatter + 本文)
  ↓
GitHub PR 作成 (content/{event-type}/{work-slug}/{post-id}-{year}.mdx)
  ↓
Firestore (ステータス更新)
```

### WordPress Pipeline (レガシー)

WordPress パイプラインは `PIPELINE_TARGET=wordpress` で有効化できますが、**本番では使用しません**。

## 主要コンポーネント

### パイプラインモード切り替え

```typescript
import { isMdxMode, isWordPressMode } from './lib/pipeline-mode';

if (isMdxMode()) {
  await runMdxPipeline();
} else {
  await runWordpressPipeline();
}
```

### MDX Pipeline Functions

- **`registerNewEvent`**: Firestore 重複チェック + ULID 生成
- **`generateArticleMetadata`**: Claude API でカテゴリ/抜粋生成
- **`generateMdxArticle`**: MDX frontmatter + 本文生成
- **`createMdxPr`**: GitHub PR 作成

### YAML Slug Mapping

- `data/title-romaji-mapping.yaml`: 作品名 → work_slug
- `data/brand-slugs.yaml`: 店舗名 → store_slug
- `data/event-type-slugs.yaml`: イベントタイプマッピング

### Firestore Canonical Keys

形式: `${workSlug}:${storeSlug}:${eventType}:${year}`

例: `sample-work:box-cafe-and-space:collabo-cafe:2025`

## 環境変数

```bash
# Pipeline Mode (MDX: 本番 | wordpress: レガシー)
PIPELINE_TARGET=mdx

# Google Cloud Project
GOOGLE_CLOUD_PROJECT=your-project-id

# Firebase Admin SDK
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}

# GitHub Configuration
GITHUB_OWNER=thanks2music
GITHUB_REPO=revolution
GITHUB_BASE_BRANCH=main

# Secrets (managed via Secret Manager)
# - GITHUB_PAT
# - ANTHROPIC_API_KEY
# - CRON_KEY
```

詳細は `.env.example` を参照してください。

## 開発コマンド

```bash
# 依存関係インストール
pnpm install

# 型チェック
pnpm type-check

# Lint
pnpm lint

# RSS Cron デバッグ
pnpm tsx scripts/debug-rss-cron.ts
```

## デバッグ方法

AI Writer には複数のデバッグオプションがあります。

### 基本コマンド: `pnpm debug:mdx`

URL から直接 MDX 記事を生成するデバッグスクリプトです。

```bash
# 基本使用法
pnpm debug:mdx <URL>

# ドライランモード（Firestore/GitHub/R2 すべてスキップ）
pnpm debug:mdx --dry-run <URL>

# ローカル保存モード（Firestore/GitHub/R2 スキップ + ローカルにMDXファイル保存）
pnpm debug:mdx --local <URL>

# 画像アップロードモード（R2にアップロード + ローカル保存、Firestore/GitHub はスキップ）
pnpm debug:mdx --upload-images <URL>
```

**コマンドライン引数**

| 引数 | 説明 |
|------|------|
| `<URL>` | 記事生成元の URL（必須） |
| `--dry-run` | Firestore 登録、GitHub PR 作成、R2 画像アップロードをすべてスキップ。AI 処理のみ実行 |
| `--local` | ローカルに MDX ファイルを保存。R2 画像アップロードもスキップ。保存先: `apps/ai-writer/content/{eventType}/{workSlug}/{postId}.mdx` |
| `--upload-images` | R2 に画像をアップロードしつつローカル保存。Firestore 登録と GitHub PR 作成はスキップ。画像 URL の動作確認に最適 |

**使用例**

```bash
# 本番実行（Firestore登録 + GitHub PR作成 + R2アップロード）
pnpm debug:mdx https://animeanime.jp/article/2025/11/24/94010.html

# ドライラン（AI処理のみ、外部サービスへの書き込みなし）
pnpm debug:mdx --dry-run https://g-tekketsu.theme-cafe.jp/

# ローカル保存（MDXファイルをローカルに保存、画像はスキップ）
pnpm debug:mdx --local https://g-tekketsu.theme-cafe.jp/

# 画像アップロード + ローカル保存（画像URLの動作確認に最適）
pnpm debug:mdx --upload-images https://g-tekketsu.theme-cafe.jp/
```

> **💡 `--local` の利用シーン**
>
> - MDX 生成結果を実際のファイルとして確認したい場合
> - フロントエンドとの統合テストをローカルで行いたい場合
> - GitHub PR を作成せずに記事内容を検証したい場合
>
> ローカル保存後は `pnpm generate:article-index` で記事インデックスを再生成し、`pnpm dev` で開発サーバーを起動して確認できます。

> **💡 `--upload-images` の利用シーン**
>
> - 画像アップロード機能の動作確認をしたい場合
> - R2 に保存された画像 URL が MDX に正しく埋め込まれるか確認したい場合
> - 画像関連の修正を本番 PR を作成せずにテストしたい場合
>
> このモードでは、画像は実際に R2 にアップロードされますが、Firestore 登録と GitHub PR 作成はスキップされます。

### 環境変数オプション

#### AI プロバイダー選択

```bash
# 環境変数でプロバイダーを指定
AI_PROVIDER=anthropic pnpm debug:mdx <URL>  # Claude（デフォルト）
AI_PROVIDER=gemini pnpm debug:mdx <URL>     # Google Gemini
AI_PROVIDER=openai pnpm debug:mdx <URL>     # ChatGPT
```

| 値 | 説明 | 必要な API キー |
|----|------|---------------|
| `anthropic` | Anthropic Claude（デフォルト） | `ANTHROPIC_API_KEY` |
| `gemini` | Google Gemini | `GEMINI_API_KEY` |
| `openai` | OpenAI ChatGPT | `OPENAI_API_KEY` |

#### DEBUG_* 環境変数

各パイプラインステップのプロンプトと処理内容を詳細表示します。

| 環境変数 | 説明 | 出力内容 |
|----------|------|---------|
| `DEBUG_SELECTION_PROMPT=true` | 記事選別ステップのデバッグ | 公式 URL 検出プロンプト全文 |
| `DEBUG_EXTRACTION_PROMPT=true` | 情報抽出ステップのデバッグ | 作品名・店舗名・開催期間抽出プロンプト全文 |
| `DEBUG_TITLE_PROMPT=true` | タイトル生成ステップのデバッグ | タイトル生成プロンプト全文 + `_reasoning`（生成理由） |
| `DEBUG_CONTENT_PROMPT=true` | 本文生成ステップのデバッグ | MDX 本文生成プロンプト全文 |
| `DEBUG_HTML_EXTRACTION=true` | HTML 抽出のデバッグ | 抽出 HTML を `debug-logs/` に保存 |

**使用例**

```bash
# タイトル生成の判断理由を確認（日付誤りのデバッグに有効）
DEBUG_TITLE_PROMPT=true AI_PROVIDER=gemini pnpm debug:mdx --dry-run https://example.com/

# 複数のデバッグフラグを同時に有効化
DEBUG_TITLE_PROMPT=true DEBUG_EXTRACTION_PROMPT=true pnpm debug:mdx --dry-run https://example.com/

# HTML 抽出結果をファイルに保存（選別失敗時のデバッグに有効）
DEBUG_HTML_EXTRACTION=true pnpm debug:mdx --dry-run https://example.com/
```

### トラブルシューティング

#### タイトルの日付が間違っている場合

```bash
# 1. タイトル生成の判断理由を確認
DEBUG_TITLE_PROMPT=true pnpm debug:mdx --dry-run <URL>

# 2. 情報抽出結果を確認（開催期間が正しく抽出されているか）
DEBUG_EXTRACTION_PROMPT=true pnpm debug:mdx --dry-run <URL>
```

#### 記事がスキップされる場合

```bash
# 1. HTML 抽出結果を確認
DEBUG_HTML_EXTRACTION=true pnpm debug:mdx --dry-run <URL>
# → debug-logs/ に HTML ファイルが保存される

# 2. 選別ロジックのプロンプトを確認
DEBUG_SELECTION_PROMPT=true pnpm debug:mdx --dry-run <URL>
```

#### AI 応答の問題を調査する場合

```bash
# 各ステップのプロンプトを順番に確認
DEBUG_SELECTION_PROMPT=true pnpm debug:mdx --dry-run <URL>   # Step 0.5
DEBUG_EXTRACTION_PROMPT=true pnpm debug:mdx --dry-run <URL>  # Step 1.5
DEBUG_TITLE_PROMPT=true pnpm debug:mdx --dry-run <URL>       # Step 4.5
DEBUG_CONTENT_PROMPT=true pnpm debug:mdx --dry-run <URL>     # Step 5
```

### その他のデバッグスクリプト

```bash
# AI ファクトリーのテスト（プロバイダー切り替え確認）
pnpm tsx scripts/test-ai-factory.ts

# AI メッセージ送信テスト
AI_PROVIDER=gemini pnpm tsx scripts/test-send-message.ts

# R2 ストレージ接続テスト
pnpm tsx scripts/test-r2-connection.ts

# OG 画像アップロードテスト
pnpm tsx scripts/test-og-image-upload.ts

# 記事画像アップロードテスト
pnpm tsx scripts/test-article-image-upload.ts

# スラッグ生成テスト
pnpm tsx scripts/test-slug-generation.ts
```

## デプロイ

```bash
# Cloud Run へデプロイ
pnpm deploy

# もしくは
gcloud run deploy ai-writer \
  --source . \
  --region asia-northeast1 \
  --platform managed
```

## API Endpoints

### Production (MDX Pipeline)

- `POST /api/cron/rss` - RSS フィードから記事生成（Cloud Scheduler 用）

### Debug Endpoints

- `GET /api/config` - 環境変数設定確認
- `GET /api/debug/github` - GitHub 接続テスト
- `POST /api/debug/article` - 記事生成テスト

## アーキテクチャ

```
apps/ai-writer/
├── app/
│   └── api/
│       ├── cron/rss/         # RSS cron エントリポイント
│       └── debug/            # デバッグエンドポイント
├── lib/
│   ├── pipeline-mode.ts      # パイプラインモード判定
│   ├── ulid/                 # ULID 生成
│   ├── config/               # YAML slug マッピング
│   ├── firestore/            # Firestore 重複チェック
│   ├── claude/               # Claude API 統合
│   ├── mdx/                  # MDX 生成
│   └── github/               # GitHub PR 作成
├── data/
│   ├── title-romaji-mapping.yaml
│   ├── brand-slugs.yaml
│   └── event-type-slugs.yaml
└── scripts/
    ├── debug-mdx-generation.ts   # MDX E2E テスト
    └── debug-rss-cron.ts         # RSS cron デバッグ
```

## 実装仕様

詳細は `/notes/02-backlog/super-mvp-scope.md` を参照してください。

- **Phase 0.1**: MDX パイプライン実装完了
- **Phase 0.2**: RSS 抽出ロジック実装
- **Phase 1**: Frontend 統合
- **Post-MVP**: WordPress コード完全削除

## Git タグ

- `headless-wp-mvp-final-20251103`: WordPress 完全版スナップショット (レガシー保存用)

---

