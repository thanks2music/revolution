#!/bin/bash
# WordPress セットアップ統合スクリプト
# 用途: WordPress環境の初期設定とプラグインインストール

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ログ関数
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 環境変数のデフォルト値
WP_ENV=${WP_ENV:-development}
BACKEND_DIR=${BACKEND_DIR:-apps/backend}

# スクリプトのルートディレクトリを取得
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log_info "WordPress セットアップを開始します"
log_info "環境: $WP_ENV"
log_info "バックエンドディレクトリ: $PROJECT_ROOT/$BACKEND_DIR"

# バックエンドディレクトリに移動
cd "$PROJECT_ROOT/$BACKEND_DIR"

# プラグインディレクトリの作成
mkdir -p wp-content/plugins
mkdir -p wp-content/mu-plugins
mkdir -p wp-content/themes

# プラグインダウンロード関数
download_plugin() {
    local plugin_name=$1
    local plugin_url=$2
    local target_dir=${3:-wp-content/plugins}

    cd "$PROJECT_ROOT/$BACKEND_DIR/$target_dir"

    if [ -d "$plugin_name" ]; then
        log_info "$plugin_name は既にインストール済み"
    else
        log_info "$plugin_name をダウンロード中..."
        curl -sL "$plugin_url" -o "$plugin_name.zip"
        unzip -q "$plugin_name.zip"
        rm "$plugin_name.zip"
        log_info "$plugin_name インストール完了"
    fi

    cd "$PROJECT_ROOT/$BACKEND_DIR"
}

# ===========================================
# 必須プラグイン（全環境）
# ===========================================
log_info ""
log_info "📦 必須プラグインのインストール"
download_plugin "wp-graphql" \
    "https://github.com/wp-graphql/wp-graphql/releases/latest/download/wp-graphql.zip"

# ===========================================
# 開発用プラグイン（開発環境のみ）
# ===========================================
if [ "$WP_ENV" = "development" ]; then
    log_info ""
    log_info "🔧 開発用プラグインのインストール"

    download_plugin "query-monitor" \
        "https://downloads.wordpress.org/plugin/query-monitor.latest-stable.zip"

    log_info "開発用プラグインのインストール完了"
fi

# ===========================================
# オプションプラグイン
# ===========================================
log_info ""
log_info "📝 オプションプラグインのインストール"

download_plugin "classic-editor" \
    "https://downloads.wordpress.org/plugin/classic-editor.latest-stable.zip"

# ===========================================
# 権限設定
# ===========================================
log_info ""
log_info "🔐 権限設定中..."
# Dockerビルド時は www-data ユーザーが存在しないためスキップ
if id -u www-data >/dev/null 2>&1; then
    chown -R www-data:www-data wp-content/
    log_info "権限設定完了"
else
    log_warn "www-data ユーザーが存在しません（Docker ビルド中の場合は正常）"
fi

# ===========================================
# 完了レポート
# ===========================================
log_info ""
log_info "✅ WordPress セットアップが完了しました！"
log_info ""
log_info "📋 インストール済みプラグイン:"
if [ -d "wp-content/plugins" ]; then
    cd wp-content/plugins
    for dir in */; do
        if [ -d "$dir" ]; then
            echo "  - ${dir%/}"
        fi
    done
    cd "$PROJECT_ROOT/$BACKEND_DIR"
fi

log_info ""
log_info "📌 次のステップ:"
log_info "  1. docker-compose up -d でローカル環境を起動"
log_info "  2. http://localhost:8080 でWordPressにアクセス"
log_info "  3. 管理画面でプラグインの設定を確認"
