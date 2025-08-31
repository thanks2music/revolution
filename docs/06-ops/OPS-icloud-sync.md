# iCloudドキュメント同期システム

## 📱 概要

iPadでドキュメントを閲覧するためのiCloud自動同期機能です。ローカルで作成・更新したドキュメントを自動的にiCloudドライブに同期し、iPad上のMWebアプリで即座に確認できます。

## 🎯 機能

- **自動同期**: ローカルのMarkdownファイルをiCloudドライブに同期
- **構造保持**: ディレクトリ構造をそのまま維持
- **分離管理**: パブリック文書と機密文書の分離
- **効率同期**: rsyncによる差分転送
- **環境変数対応**: 個人情報の分離とパブリックリポジトリ対応

## 🗂️ 同期対象と同期先

| ローカル | iCloud | 内容 |
|---------|--------|------|
| `docs/` | `iCloud/{REPO_NAME}/docs/` | パブリックドキュメント |
| `.claude/` | `iCloud/{REPO_NAME}/dot-claude/` | 機密ドキュメント |

## 🚀 セットアップ

### 1. 環境変数ファイルの作成

```bash
# テンプレートをコピー
cp .env.local.example .env.local
```

### 2. 環境変数の設定

`.env.local` を編集してあなたの環境に合わせて設定：

```bash
# プロジェクトルートの絶対パス
PROJECT_ROOT="/path/to/your/project"

# iCloudドライブ内のフォルダの絶対パス
ICLOUD_DRIVE_PATH="/Users/YOUR_USERNAME/Library/Mobile Documents/YOUR_APP"
```

**設定例**:
```bash
PROJECT_ROOT="/Users/stephcurry/work/revolution"
ICLOUD_DRIVE_PATH="/Users/stephcurry/Library/Mobile Documents/iCloud~com~coderforart~iOS~MWeb/Documents/" # e.g MwebPro
```

### 3. 必要なツールの確認

以下のツールが利用可能である必要があります：

- `rsync` (通常macOSにプリインストール)
- `find` (通常macOSにプリインストール)

## 📋 使用方法

### 全ドキュメント同期

```bash
# 全ドキュメントを一括同期
./scripts/sync-docs-to-icloud.sh
```

**実行結果例**:
```
[INFO] 📚 {REPO_NAME} ドキュメント同期を開始します...
[INFO] 📄 パブリックドキュメント（docs/）を同期中...
[SUCCESS] パブリックドキュメント同期完了: 16個のMarkdownファイル
[INFO] 🔐 機密ドキュメント（.claude/）を同期中...
[SUCCESS] 機密ドキュメント同期完了: 27個のMarkdownファイル
[SUCCESS] ✅ {REPO_NAME} ドキュメント同期が完了しました！
```

### 特定ドキュメント作成後の同期

```bash
# パブリックドキュメントの場合
./scripts/create-doc-and-sync.sh docs {FILE_NAME}.md

# 機密ドキュメントの場合
./scripts/create-doc-and-sync.sh private {FILE_NAME}.md
```

## 🔧 スクリプトの詳細

### sync-docs-to-icloud.sh

**機能**: 全ドキュメントを一括同期する主要スクリプト

**特徴**:
- 環境変数による設定読み込み
- .mdファイルのみを同期（不要ファイル除外）
- ディレクトリ構造の保持
- 削除されたファイルの自動クリーンアップ

### create-doc-and-sync.sh

**機能**: 特定ドキュメントの存在確認後に同期を実行するヘルパー

**使用方法**:
```bash
./scripts/create-doc-and-sync.sh <docs|private> <relative_path>
```

**引数**:
- `docs`: パブリックドキュメント（`docs/`）
- `private`: 機密ドキュメント（`.claude/`）

## 🔄 メンテナンス

### 定期的な確認項目

1. **同期状況の確認**
   ```bash
   ./scripts/sync-docs-to-icloud.sh
   ```

2. **不要ファイルのクリーンアップ**
   - 同期システムが自動的に削除されたファイルをクリーンアップ

3. **環境変数の確認**
   - プロジェクトパスの変更があった場合は`.env.local`を更新
