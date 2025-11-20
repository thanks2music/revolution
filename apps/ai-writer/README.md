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

例: `jujutsu-kaisen:box-cafe-and-space:collabo-cafe:2025`

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

# MDX 生成デバッグ (E2E テスト)
pnpm tsx scripts/debug-mdx-generation.ts

# RSS Cron デバッグ
pnpm tsx scripts/debug-rss-cron.ts
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

🤖 このシステムは **Claude Code** と **Claude API** を活用して開発されています。
