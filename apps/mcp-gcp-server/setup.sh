#!/bin/bash

# MCPサーバーセットアップスクリプト
set -e

echo "=========================================="
echo "MCP Server for GCP WordPress Setup"
echo "=========================================="
echo ""

# カラー設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Node.jsチェック
echo "1. Node.js環境確認..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.jsがインストールされていません${NC}"
    echo "  Node.js v18以上をインストールしてください"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
echo -e "${GREEN}✓ Node.js v${NODE_VERSION}${NC}"

# 依存関係インストール
echo ""
echo "2. 依存関係インストール..."
npm install
echo -e "${GREEN}✓ 依存関係インストール完了${NC}"

# .envファイルチェック
echo ""
echo "3. 環境変数設定..."
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${YELLOW}⚠ .envファイルを作成しました${NC}"
        echo "  .envファイルを編集して必要な環境変数を設定してください："
        echo ""
        echo "  必須項目："
        echo "  - GOOGLE_CLOUD_PROJECT_ID"
        echo "  - GOOGLE_APPLICATION_CREDENTIALS"
        echo "  - GCS_BUCKET_NAME"
        echo "  - CLOUD_RUN_SERVICE_NAME"
        echo "  - CLOUD_SQL_INSTANCE_NAME"
    else
        echo -e "${RED}✗ .env.exampleが見つかりません${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ .envファイルが存在します${NC}"
fi

# ビルド
echo ""
echo "4. TypeScriptビルド..."
npm run build
echo -e "${GREEN}✓ ビルド完了${NC}"

# Claude Desktop設定表示
echo ""
echo "=========================================="
echo "セットアップ完了！"
echo "=========================================="
echo ""
echo "次のステップ："
echo ""
echo "1. .envファイルを編集して環境変数を設定"
echo "   ${YELLOW}vi .env${NC}"
echo ""
echo "2. サービスアカウントキーを作成"
echo "   ${YELLOW}gcloud iam service-accounts keys create credentials.json \\
   --iam-account=mcp-server-account@YOUR_PROJECT_ID.iam.gserviceaccount.com${NC}"
echo ""
echo "3. Claude Desktop設定ファイルを編集"
echo "   macOS/Linux: ${YELLOW}~/.claude_desktop_config.json${NC}"
echo "   Windows: ${YELLOW}%APPDATA%\\Claude\\claude_desktop_config.json${NC}"
echo ""
echo "設定例："
echo '```json'
echo '{'
echo '  "mcpServers": {'
echo '    "gcp-wordpress": {'
echo '      "command": "node",'
echo "      \"args\": [\"$(pwd)/dist/index.js\"],"
echo '      "env": {'
echo "        \"GOOGLE_APPLICATION_CREDENTIALS\": \"$(pwd)/credentials.json\""
echo '      }'
echo '    }'
echo '  }'
echo '}'
echo '```'
echo ""
echo "詳細はREADME.mdを参照してください。"