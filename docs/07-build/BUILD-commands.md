# 開発・ビルドコマンド一覧

> Revolution 現行版（モノレポ + pnpm + Turbo）で使用する開発・ビルドコマンドのリファレンス。
> ビルドシステム全体の設計は [`BUILD-overview.md`](./BUILD-overview.md) を参照してください（Make / Docker 周りはレガシー WordPress 時代の記述が含まれます）。

## 前提条件

- **Node.js**: 22.0.0 以上
- **pnpm**: 10.0.0 以上
- **Google Cloud SDK**: Cloud Run デプロイ用（オプション）

## ルートレベル（モノレポ）

```bash
# 統合起動（Turbo 並行実行）
pnpm dev              # frontend (4444) + ai-writer (7777) を並行起動
pnpm build            # 両アプリをビルド
pnpm clean            # turbo run clean
pnpm fresh            # clean + pnpm install

# 個別ワークスペース起動（Turbo フィルタ経由）
pnpm dev:frontend     # フロントエンドのみ (http://localhost:4444)
pnpm dev:ai-writer    # AI Writer のみ (http://localhost:7777)
pnpm build:frontend   # フロントエンドのみビルド
pnpm build:ai-writer  # AI Writer のみビルド

# テスト & 品質チェック（Turbo run）
pnpm test             # 全テストを実行
pnpm lint             # 全ワークスペースを Lint
pnpm type-check       # TypeScript 検証

# Vercel デプロイ
pnpm deploy:frontend  # apps/frontend を vercel --prod
```

### Makefile wrapper

`make dev` / `make build` / `make clean` / `make stop` / `make status` は上記 `pnpm` コマンドを呼ぶ薄い wrapper です。`make stop` は port 4444 / 7777 で listening しているプロセスを停止し、`make status` は両 port の稼働状況を表示します。

### worktree 並行起動時の注意

複数の git worktree で同時に dev サーバーを動かす場合は port 衝突を避けるため、`bash scripts/worktree-dev.sh frontend` / `bash scripts/worktree-dev.sh ai-writer` を使ってください。`pnpm dev` / `make dev` は常にデフォルト port (4444 / 7777) で起動します。

## AI Writer (`apps/ai-writer/`)

```bash
cd apps/ai-writer

# 開発
pnpm dev              # ポート 7777 で起動
pnpm restart          # 強制終了 & 再起動

# テスト
pnpm test             # Jest テストを実行
pnpm test:watch       # ウォッチモード
pnpm test:coverage    # カバレッジレポート

# Firebase 管理者
pnpm admin:setup      # 管理者ユーザーをセットアップ
pnpm admin:list       # 管理者をリスト表示
```

## Frontend (`apps/frontend/`)

```bash
cd apps/frontend

# 開発
pnpm dev              # ポート 4444 で起動（Turbopack デフォルト）

# ビルド & 検証
pnpm build            # 本番ビルド
pnpm start            # 本番モードで起動
pnpm type-check       # TypeScript 型チェック
pnpm lint             # ESLint 9 Flat Config
pnpm validate-env     # 環境変数検証
```

## 環境変数の初期セットアップ

```bash
# テンプレートからローカル設定を作成
cp apps/ai-writer/.env.sample apps/ai-writer/.env.local
cp apps/frontend/.env.sample apps/frontend/.env.local
```

詳細は各ワークスペースの `.env.sample` を参照してください。

## コミット規約

```
✨ feat:      新機能追加
🐛 fix:       バグ修正
📝 docs:      ドキュメント
🔧 config:    設定変更
♻️  refactor: コードリファクタリング
🧪 test:      テスト追加
🎨 style:     コードフォーマット
⚡️ perf:      パフォーマンス改善
```

## 関連ドキュメント

- [ビルドシステム概要](./BUILD-overview.md)
- [現行版 技術スタック](../01-arch/ARCH-current-stack.md)
- [Frontend: ページ Props 型定義](../05-frontend/FE-page-props-types.md)
- [CI/CD（AI Writer Cloud Run デプロイ）](../08-cicd/CICD-ai-writer-cloud-run.md)
