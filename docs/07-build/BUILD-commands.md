# 開発・ビルドコマンド一覧

> Revolution 現行版（モノレポ + pnpm + Turbo）で使用する開発・ビルドコマンドのリファレンス。
> ビルドシステム全体の設計は [`BUILD-overview.md`](./BUILD-overview.md) を参照してください（Make / Docker 周りはレガシー WordPress 時代の記述が含まれます）。

## 前提条件

- **Node.js**: 22.0.0 以上
- **pnpm**: 10.0.0 以上
- **Google Cloud SDK**: Cloud Run デプロイ用（オプション）

## ルートレベル（モノレポ）

> ⚠️ **注意**: ルート `package.json` の `dev` / `build` / `clean` / `fresh` / `dev:backend` / `build:backend` / `deploy` / `deploy:backend` スクリプトは、PR #117 で削除された `apps/backend` を参照する `Makefile` ターゲットに依然として委譲しているため**現状動作しません**。下記の表は「動くもの / 動かないもの」を区別しています。クリーンアップは別 PR で対応予定。

### 動作する root レベルコマンド

```bash
# 個別ワークスペース起動（Turbo フィルタ経由）
pnpm dev:frontend     # フロントエンドのみ (http://localhost:4444)
pnpm build:frontend   # フロントエンドのみビルド

# テスト & 品質チェック（Turbo run）
pnpm test             # 全テストを実行
pnpm lint             # 全ワークスペースを Lint
pnpm type-check       # TypeScript 検証

# Vercel デプロイ
pnpm deploy:frontend  # apps/frontend を vercel --prod
```

### 現状壊れている root レベルコマンド（参考）

| コマンド | 状態 | 原因 |
|---|---|---|
| `pnpm dev` | ❌ | `make dev` → 削除済み `apps/backend` を起動しようとする |
| `pnpm dev:backend` | ❌ | `make backend` → 削除済み `apps/backend` |
| `pnpm build` | ❌ | `make build` → `cd apps/backend && make build` |
| `pnpm clean` | ❌ | `make clean` → `cd apps/backend && make clean` |
| `pnpm fresh` | ❌ | `make clean &&` の段階で失敗 |
| `pnpm deploy` / `pnpm deploy:backend` | ❌ | 同上 |

各ワークスペースに `cd` してから `pnpm dev` / `pnpm build` を直接叩くか、上記の `pnpm dev:frontend` 等を使ってください。

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
