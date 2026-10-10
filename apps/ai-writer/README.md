# AI Writer (Discovery) - Revolution

**自動記事生成システム** - RSS フィードからアニメコラボイベント記事を生成し、GitHub PR 経由で Revolution に投稿します。

## 現行パイプライン

**MDX パイプライン** が本番運用モードです。

### 📐 パイプラインの構成

記事 (公式サイト) の URL を入力に、複数の step を順に実行して MDX 記事と GitHub PR を作ります。本体は `lib/services/article-generation-mdx.service.ts` の `generateMdxFromRSS()` です。

- **step の ID と順序の真実源**は [`lib/services/pipeline-steps.ts`](./lib/services/pipeline-steps.ts) の `PIPELINE_STEPS` です。step の数はこの文書に書きません (足すと古びるため)
- ログは `[N/M id] label` の形で出ます。N は配列の位置なので step を足すと変わります。ログを突き合わせるときは id を使ってください
- 新しい処理を top-level の step にするか、既存の step の中の処理にするかの基準は `pipeline-steps.ts` の冒頭のコメントにあります

### 情報の流れ (概要)

```text
記事 (公式サイト) の URL
  ↓ 記事の選別 → 作品・店舗・種別の抽出 → 公式サイトの HTML からの詳細抽出
  ↓ 下層ページ (メニュー/ノベルティ/グッズ) と画像の収集 → Vision (条件付き)
  ↓ slug の解決 → 重複チェックと採番 (Firestore)
  ↓ 抜粋・タイトル・リード文・本文の生成
  ↓ 画像の R2 アップロード → プレースホルダーの置換と検査
  ↓ MDX の組み立て → GitHub PR (1 記事 = 1 PR) → Firestore の状態更新
```

`app/api/cron/rss/route.ts` (Cloud Run の cron) は別の実装で、上の流れの多くを通りません。現在は休眠中です。

## 主要コンポーネント

### MDX Pipeline Functions

- **`registerNewEvent`**: Firestore 重複チェック + ULID 生成
- **`generateArticleMetadata`**: 抜粋を生成 (カテゴリは `buildCategories` で決定的に作る)
- **`generateMdxArticle`**: MDX frontmatter + 本文生成
- **`createMdxPr`**: GitHub PR 作成

### YAML Slug Mapping

private repo (`revolution-templates`) から `pnpm sync:templates` で `templates/config/` に写したものを読みます。

- `templates/config/title-romaji-mapping.yaml`: 作品名 → work_slug
- `templates/config/brand-slugs.yaml`: 店舗名 → store_slug
- `templates/config/event-type-slugs.yaml`: イベントタイプマッピング

### Firestore Canonical Keys

形式: `${workSlug}:${storeSlug}:${eventType}:${year}`

例: `sample-work:box-cafe-and-space:collabo-cafe:2025`

## 環境変数

```bash
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

## テストカバレッジ

カバレッジ計測は **opt-in** で行う (`collectCoverage` は `jest.config.mjs` で `false` 維持)。常時収集は全 Jest 実行を遅くするため、必要時のみ `--coverage` フラグで計測する ([Jest 公式](https://jestjs.io/docs/configuration#collectcoverage-boolean): `collectCoverage: true` は全実行ファイルに計測文を後付けし「テストを著しく遅くしうる」)。

```bash
# カバレッジ計測 (e2e 除外、coverage/ に lcov/html 生成)
pnpm test:coverage
```

### Baseline (最終計測: 2026-05-24 / v8 provider)

> 固定値ではなく living record。計測のたびに本テーブルを上書き更新する。

| 指標 | All files |
|------|-----------|
| % Statements | 29.5 |
| % Branches | 74.7 |
| % Functions | 41.55 |
| % Lines | 29.5 |

- Test Suites: 33 passed / Tests: 706 passed
- 層別 TDD の Phase 1 即時施策の baseline スナップショット。Phase 2 で 50% threshold + CI ゲート導入を検討する際の根拠値 (設計方針を記す `llm-context/development-principles.md`「段階的カバレッジ目標」は **リポジトリ非追跡 / 開発者ローカル参照**)
- 高カバレッジ領域: `lib/services/vision-api/` (83.86%) / `lib/mdx/` (92.7%) / `lib/config/` (80.15%) / `lib/services/pipeline-steps.ts` (100%)。未カバー領域: `app/` 配下 API routes / pages、`lib/github/` / `lib/types/` は 0% (`lib/slack/` は 2026-10 の bot token 化でテストを追加)
- ※ `collectCoverageFrom` は未実行ファイルも集計対象に含む (テストが無くても 0% として計上される)。`% Statements`/`% Lines` が低いのは、未実行の app routes・型定義ファイルが多数の未カバー行を母数に加えるため。一方 `% Branches` 74.7% が相対的に高いのは、それら未カバーファイル (API routes・型定義) が分岐文をほとんど持たず分岐の母数を押し下げず、網羅済みファイルが分岐母数の大半を占めるため

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

# 1Password の参照を解決せずに実行（Slack 通知なし。1Password がロック中・オフラインの時）
pnpm debug:mdx:raw <URL>
```

**Slack 通知**: `pnpm debug:mdx` は実行結果（成功時は PR の URL、スキップ、失敗）を開発系チャンネルへ 1 通送る。
token は `apps/ai-writer/.env.op.local` に書いた 1Password の参照を `op run` が解決する（`scripts/with-op-env.sh`）。
`.env.op.local` か op CLI が無ければ通知なしで実行される。設定は `.env.sample` の「Slack 通知」節を参照。
Claude などが非対話で実行する場合、1Password のロック解除を待って止まることがあるため `pnpm debug:mdx:raw` を使う。

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
AI_PROVIDER=google pnpm debug:mdx <URL>     # Google Gemini
AI_PROVIDER=openai pnpm debug:mdx <URL>     # ChatGPT
```

| 値 | 説明 | 必要な API キー |
|----|------|---------------|
| `anthropic` | Anthropic Claude（デフォルト） | `ANTHROPIC_API_KEY` |
| `google` | Google Gemini | `GEMINI_API_KEY` |
| `openai` | OpenAI ChatGPT | `OPENAI_API_KEY` |

#### AI ステップの観測ログ（推奨。まずこれを使う）

**`--log` を付けるだけで、全 AI ステップの入出力が構造化ログに残ります。** `DEBUG_*` を
1 つも設定する必要はありません。

```bash
pnpm debug:mdx --dry-run --log https://example.com/
```

| 出力 | 内容 |
|---|---|
| `logs/{日付}-{ドメイン}-{連番}.log` | 実行ログ（従来どおり） |
| `logs/{同じ basename}.jsonl` | **1 行 = 1 回の AI 呼び出し**。要求/応答モデル・所要時間・token 使用量・応答全文・入出力の SHA-256 |
| `logs/prompts/{run}-{seq}-{step}.txt` | プロンプト全文（実行間でほぼ不変かつ巨大なため別ファイルへ退避） |

プロンプトが実行間で変化したかは JSONL の `promptSha256` を比べれば分かり、変化していた
場合だけ退避ファイルを diff すればよい構造です。

> **⚠️ なぜ `DEBUG_*` より先にこれを使うのか**
>
> `DEBUG_*_PROMPT` は 11 個に分裂しており、**`DEBUG_EXTRACTION_PROMPT` だけが未設定**
> だったために「抽出ステップのプロンプトが 1 行も残らない」状態が続き、原因の切り分けに
> 5 時間を要した実績があります（2026-08-11）。観測ログは**フラグに依存せず既定で記録**
> するため、同じ取りこぼしが起きません。

| 環境変数 | 説明 |
|---|---|
| `DEBUG_AI_STEPS=all` | `--log` を使わない経路（API Route 等）でも記録する |
| `DEBUG_AI_STEPS=detail-extraction,title-generation` | 指定ステップのみ記録する |

`NODE_ENV=production` では常に無効です（Cloud Run は ephemeral FS で再起動時に消えるため）。

記録した JSONL は比較・照合ツールへそのまま渡せます（**どちらも AI API を呼ばないので課金なし**）。

```bash
# 同一 URL の N 回実行を突き合わせる（何が同じで何が割れたかだけを出す）
pnpm debug:compare logs/2026-08-12-example-com-*.jsonl

# 公式サイトの掲載内容と照合し、「系統的」か「確率的」かを判定する
pnpm debug:compare logs/*.jsonl --source https://example.com/

# 正解データだけを見る / 保存済み HTML を使う（ネットワーク不要）
pnpm debug:verify https://example.com/
pnpm debug:verify --html debug-logs/html-xxx.html --against logs/xxx.jsonl
```

> **⚠️ 実行どうしの一致は「正しさ」ではない。**
> 3 回とも同じように会場を落とせば「完全に一致」だが「安定して間違っている」。
> 合否判定には必ず `--source` / `--against` で正解データを渡すこと。渡さない場合は
> 判定を出さず（`判定なし`）、実行間の差分だけを表示します。

#### DEBUG_* 環境変数（個別フラグ）

各パイプラインステップのプロンプトと処理内容を**本体ログへ**詳細表示します。

> ℹ️ 観測ログ（上記）が有効なときは、**プロンプト全文の本体ログへの出力は自動で抑止**され、
> ポインタ 1 行だけになります。同じ内容が `logs/prompts/` に残っているためで、**情報は
> 失われず置き場所が変わるだけ**です（実測では本体ログ 2196 行のうち 1211 行 = 55% が
> プロンプト全文で、実際の出力がテンプレ由来の文字列に埋もれていました）。

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
DEBUG_TITLE_PROMPT=true AI_PROVIDER=google pnpm debug:mdx --dry-run https://example.com/

# 複数のデバッグフラグを同時に有効化
DEBUG_TITLE_PROMPT=true DEBUG_EXTRACTION_PROMPT=true pnpm debug:mdx --dry-run https://example.com/

# HTML 抽出結果をファイルに保存（選別失敗時のデバッグに有効）
DEBUG_HTML_EXTRACTION=true pnpm debug:mdx --dry-run https://example.com/
```

### トラブルシューティング

#### まず `--log` で 1 回実行する（フラグを探す前に）

```bash
pnpm debug:mdx --dry-run --log <URL>
```

全 AI ステップの入出力が `logs/*.jsonl` に残るので、**どのステップで何が起きたかを
1 ファイルで追えます**。以下の個別フラグは「観測ログで当たりを付けた後、本体ログに
プロンプトを並べて読みたいとき」に使ってください。

```bash
# 特定ステップの入出力だけを取り出す
jq -r 'select(.stepId=="detail-extraction") | .responseText' logs/<run>.jsonl

# 実行間で入力が同一かを確認する (同一なのに出力が違えば非決定性)
jq -r '[.stepId, .promptSha256[0:12], .responseSha256[0:12]] | @tsv' logs/<run>.jsonl
```

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
DEBUG_SELECTION_PROMPT=true pnpm debug:mdx --dry-run <URL>   # article-selection step
DEBUG_EXTRACTION_PROMPT=true pnpm debug:mdx --dry-run <URL>  # detail-extraction step
DEBUG_TITLE_PROMPT=true pnpm debug:mdx --dry-run <URL>       # title-generation step
DEBUG_CONTENT_PROMPT=true pnpm debug:mdx --dry-run <URL>     # content-generation step
```

### その他のデバッグスクリプト

```bash
# AI ファクトリーのテスト（プロバイダー切り替え確認）
pnpm tsx scripts/test-ai-factory.ts

# AI メッセージ送信テスト
AI_PROVIDER=google pnpm tsx scripts/test-send-message.ts

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

```text
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

詳細は `/notes/archive/super-mvp-scope.md` を参照してください。

- **Phase 0.1**: MDX パイプライン実装完了
- **Phase 0.2**: RSS 抽出ロジック実装
- **Phase 1**: Frontend 統合
- **Post-MVP**: WordPress パイプラインコード削除済み (Sprint 2 / Schema-SDD Phase 2)

## Git タグ

- `headless-wp-mvp-final-20251103`: WordPress 完全版スナップショット (レガシー保存用)

---
