# スクリプトアーキテクチャガイド

## 📁 ディレクトリ構造と責務

```
revolution/
├── scripts/                    # プロジェクト全体のスクリプト（実体）
│   ├── deploy.sh               # Cloud Run デプロイ
│   ├── generate-wp-secrets.sh  # Secret Manager 設定
│   └── setup-wordpress.sh      # WordPress 初期設定（統合版）※実体
├── apps/
│   ├── backend/
│   │   ├── Dockerfile          # スクリプトを参照
│   │   └── setup-wordpress.sh  # → ../../scripts/setup-wordpress.sh へのシンボリックリンク
│   └── frontend/
└── docs/

```

## 🎯 設計原則

### 1. **単一責任の原則**

- `scripts/` ディレクトリが全てのスクリプトを管理
- 各アプリケーションディレクトリはアプリケーション固有のコードのみ

### 2. **DRY原則（Don't Repeat Yourself）**

- プラグインインストールロジックを一箇所に集約
- 環境変数による挙動の切り替え

### 3. **Discovery**

- 新規参加者が「scripts/」を見れば全ての操作がわかる
- 一貫した命名規則（動詞-名詞.sh）

## 🔄 移行手順

### Step 1: 既存スクリプトのバックアップ
```bash
# バックアップ作成
cp apps/backend/install-plugins.sh apps/backend/install-plugins.sh.bak
cp apps/backend/setup-graphql.sh apps/backend/setup-graphql.sh.bak
```

### Step 2: 統合スクリプトの実行
```bash
# WordPress セットアップ（開発環境）
WP_ENV=development ./scripts/setup-wordpress.sh

# WordPress セットアップ（本番環境）
WP_ENV=production ./scripts/setup-wordpress.sh
```

### Step 3: 古いスクリプトの削除
```bash
# 動作確認後に削除
rm apps/backend/install-plugins.sh
rm apps/backend/setup-graphql.sh
rm apps/backend/*.sh.bak
```

## 🚀 使用例

### ローカル開発環境の構築
```bash
# 1. WordPress セットアップ
./scripts/setup-wordpress.sh

# 2. Docker 起動
cd apps/backend
docker-compose up -d

# 3. 確認
open http://localhost:8080
```

### 本番デプロイ
```bash
# 1. シークレット生成
./scripts/generate-wp-secrets.sh

# 2. デプロイ
./scripts/deploy.sh
```

## 📋 スクリプト一覧と用途

| スクリプト | 用途 | 実行タイミング |
|----------|------|--------------|
| `scripts/deploy.sh` | Cloud Run デプロイ | 本番リリース時 |
| `scripts/generate-wp-secrets.sh` | セキュリティキー生成 | 初回セットアップ時 |
| `scripts/setup-wordpress.sh` | WP環境構築 | 開発環境構築時・Dockerビルド時 |

## ⚠️ 注意事項

1. **Dockerfile での参照**
   - Docker のコンテキストの制約により、親ディレクトリの参照に制限あり
   - 必要に応じてビルドコンテキストを調整

2. **環境変数**
   - `WP_ENV`: development | production | staging
   - `BACKEND_DIR`: バックエンドディレクトリパス（デフォルト: apps/backend）

3. **権限管理**
   - スクリプトには実行権限が必要（`chmod +x`）
   - Docker 内では www-data ユーザーでの実行を考慮

## 🎯 期待される効果

1. **保守性向上**: スクリプトの場所が明確
2. **再利用性**: CI/CD での活用が容易
3. **一貫性**: プロジェクト全体で統一された構造
4. **効率性**: 重複コードの削減
