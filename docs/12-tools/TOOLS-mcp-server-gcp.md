# MCP Server for Google Cloud WordPress Management

WordPress on Cloud Run環境を管理するためのModel Context Protocol (MCP)サーバーです。
Claude Desktopから直接Google Cloudリソースを操作・監視できます。

## 重要な開発原則

### MCP STDIO サーバーの重要な制約

**絶対に標準出力（stdout）に書き込まないでください。**

MCP-08公式ドキュメントより:
- ❌ 禁止: `console.log()`, `print()`, `fmt.Println()`
- ✅ 許可: `console.error()` (stderr), ログファイルへの出力

標準出力への書き込みはJSON-RPCメッセージを破損させ、サーバーを機能不全にします。

## 機能

### 🏥 ヘルスチェック & 監視
- **WordPressヘルスチェック**: Cloud Run、GCS統合、データベース接続の総合診断
- **ログ監視**: Cloud Runの最新ログ確認（エラー、警告、情報レベル）
- **ステータス確認**: Cloud Runサービスの状態と設定の取得

### 📁 ストレージ管理
- **メディアファイル一覧**: GCSバケット内のWordPressメディアファイル管理
- **使用状況分析**: ファイルタイプ別・年別の詳細な使用量分析
- **ファイル検索**: プレフィックス指定による効率的なファイル検索

### 🔐 セキュリティ & バックアップ
- **データベースバックアップ**: Cloud SQLの手動バックアップ作成
- **シークレット管理**: Secret Managerの秘密情報一覧（値は非表示）

## セットアップ

### 1. 依存関係のインストール

```bash
cd apps/mcp-gcp-server
npm install
```

### 2. 環境変数の設定

`.env`ファイルを作成し、必要な環境変数を設定します：

```bash
cp .env.example .env
```

必要な環境変数：
- `GOOGLE_CLOUD_PROJECT_ID`: GCPプロジェクトID
- `GOOGLE_APPLICATION_CREDENTIALS`: サービスアカウントキーファイルへのパス
- `GCS_BUCKET_NAME`: メディアファイル用GCSバケット名
- `CLOUD_RUN_SERVICE_NAME`: Cloud Runサービス名
- `CLOUD_SQL_INSTANCE_NAME`: Cloud SQLインスタンス名

### 3. サービスアカウントの作成

```bash
# サービスアカウント作成
gcloud iam service-accounts create mcp-server-account \
    --display-name="MCP Server Service Account"

# 必要な権限を付与
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.viewer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

# 実運用では storage.admin が必要（objectViewer では不足）

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudsql.viewer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.viewer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/logging.viewer"

# キーファイルを生成
gcloud iam service-accounts keys create credentials.json \
    --iam-account=mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 4. ビルド

```bash
npm run build
```

## Claude Desktop設定

### 設定ファイルの場所

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**重要**: MCP-06公式ドキュメントに従い、macOSでは `Library/Application Support/Claude/` 内が正しいパスです。

### 設定例

```json
{
  "mcpServers": {
    "gcp-wordpress": {
      "command": "node",
      "args": ["/absolute/path/to/revolution/apps/mcp-gcp-server/dist/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/credentials.json"
      }
    }
  }
}
```

## 使用方法

Claude Desktopを起動し、以下のようなコマンドを実行できます：

### ヘルスチェック
```
「WordPressサイトの状態を確認して」
「GCS統合が正常に動作しているか確認して」
「データベース接続をチェックして」
```

### ログ確認
```
「最近のエラーログを見せて」
「警告レベル以上のログを20件取得して」
```

### メディアファイル管理
```
「最新のメディアファイル10件を表示して」
「2024年にアップロードされた画像を確認して」
「GCSの使用状況を分析して」
```

### バックアップ
```
「データベースのバックアップを作成して」
「バックアップに'定期メンテナンス前'という説明をつけて」
```

## 利用可能なツール

| ツール名 | 説明 | 主な用途 |
|---------|------|----------|
| `check_wordpress_health` | 総合ヘルスチェック | サイト全体の健全性確認 |
| `list_gcs_media_files` | メディアファイル一覧 | ファイル管理と確認 |
| `get_cloud_run_status` | Cloud Run状態取得 | サービス設定の確認 |
| `check_recent_logs` | ログ確認 | エラー調査とデバッグ |
| `backup_database` | DBバックアップ | データ保護 |
| `list_secrets` | シークレット一覧 | 設定管理 |
| `analyze_gcs_usage` | GCS使用状況分析 | コスト最適化 |

## 開発

### ローカル開発

```bash
# TypeScriptのウォッチモード
npm run dev

# 型チェック
npm run typecheck

# Lint
npm run lint
```

### テスト実行

```bash
# MCPサーバーを直接起動してテスト
npm start
```

## トラブルシューティング

### MCPサーバーが Claude Desktop に認識されない場合

**MCP-06公式手順に従った診断:**

1. **設定ファイルパスの確認**:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`（必須）
   - JSON構文エラーのチェック
   - 絶対パス（相対パスではない）の使用確認

2. **Claude Desktop の完全再起動**:
   - アプリケーションを完全終了
   - 設定変更後は必ず再起動

3. **手動サーバーテスト**:
```bash
# サーバーを直接実行してエラー確認
node /absolute/path/to/revolution/apps/mcp-gcp-server/dist/index.js
```

4. **Claude Desktop ログの確認**:
```bash
# macOS
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log

# Windows
type "%APPDATA%\Claude\logs\mcp*.log"
```

### 認証エラーが発生する場合

1. サービスアカウントキーファイルのパスが正しいか確認
2. 必要な権限がサービスアカウントに付与されているか確認
3. `GOOGLE_APPLICATION_CREDENTIALS`環境変数が正しく設定されているか確認

### Cloud Runに接続できない場合

1. プロジェクトIDとリージョンが正しいか確認
2. Cloud Run APIが有効になっているか確認
3. サービスアカウントに`roles/run.viewer`権限があるか確認

### GCSバケットにアクセスできない場合

1. バケット名が正しいか確認
2. バケットが存在するか確認
3. サービスアカウントに`roles/storage.admin`権限があるか確認
4. MCP-06式デバッグの実行:

```bash
# Claude Desktop ログの確認（macOS）
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log

# サーバーの手動テスト
node /path/to/apps/mcp-gcp-server/dist/index.js

# 権限の確認
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```
