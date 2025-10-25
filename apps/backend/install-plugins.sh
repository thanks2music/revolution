#!/bin/bash
# WordPress プラグイン自動インストールスクリプト
# plugins.json を基にプラグインをインストール・有効化

set -euo pipefail

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_debug() { echo -e "${BLUE}[DEBUG]${NC} $1"; }

# 環境変数のデフォルト値
WP_ENV=${WP_ENV:-production}
PLUGINS_JSON=${PLUGINS_JSON:-/var/www/html/plugins.json}
WP_PATH=${WP_PATH:-/var/www/html}

log_info "========================================"
log_info "WordPress Plugin Installer"
log_info "========================================"
log_info "Environment: $WP_ENV"
log_info "Config File: $PLUGINS_JSON"
log_info "WordPress Path: $WP_PATH"
log_info ""

# plugins.json の存在確認
if [ ! -f "$PLUGINS_JSON" ]; then
    log_error "plugins.json not found at $PLUGINS_JSON"
    exit 1
fi

# jq の存在確認
if ! command -v jq &> /dev/null; then
    log_error "jq is required but not installed"
    exit 1
fi

# WP-CLI の存在確認
if ! command -v wp &> /dev/null; then
    log_error "WP-CLI is required but not installed"
    exit 1
fi

# WordPress ディレクトリに移動
cd "$WP_PATH"

# プラグインカウンター
TOTAL_PLUGINS=0
INSTALLED_PLUGINS=0
ACTIVATED_PLUGINS=0
SKIPPED_PLUGINS=0
FAILED_PLUGINS=0

log_info "📦 Processing free plugins..."
log_info ""

# plugins.json から無料プラグインを読み込んで処理
jq -c '.plugins.free[]' "$PLUGINS_JSON" | while read -r plugin; do
    TOTAL_PLUGINS=$((TOTAL_PLUGINS + 1))

    slug=$(echo "$plugin" | jq -r '.slug')
    name=$(echo "$plugin" | jq -r '.name')
    version=$(echo "$plugin" | jq -r '.version')
    version_dev=$(echo "$plugin" | jq -r '.version_dev // "latest"')
    activate=$(echo "$plugin" | jq -r '.activate')
    env=$(echo "$plugin" | jq -r '.env // empty')

    # 環境チェック（env指定がある場合のみ）
    if [ -n "$env" ] && [ "$env" != "null" ] && [ "$env" != "$WP_ENV" ]; then
        log_warn "⏭️  Skipping $name (env: $env, current: $WP_ENV)"
        SKIPPED_PLUGINS=$((SKIPPED_PLUGINS + 1))
        continue
    fi

    # バージョン選択（開発環境は latest、本番は固定）
    if [ "$WP_ENV" = "development" ] && [ "$version_dev" != "null" ] && [ "$version_dev" != "latest" ]; then
        install_version="$version_dev"
    elif [ "$WP_ENV" = "development" ]; then
        install_version="latest"
    else
        install_version="$version"
    fi

    log_info "📥 Processing: $name ($slug)"
    log_debug "   Target version: $install_version"

    # プラグインが既にインストールされているかチェック
    if wp plugin is-installed "$slug" --allow-root 2>/dev/null; then
        log_info "   Already installed"

        # バージョンチェックと更新（latestでない場合）
        if [ "$install_version" != "latest" ]; then
            current_version=$(wp plugin get "$slug" --field=version --allow-root 2>/dev/null || echo "unknown")
            if [ "$current_version" != "$install_version" ]; then
                log_info "   Updating from $current_version to $install_version"
                if wp plugin update "$slug" --version="$install_version" --allow-root 2>/dev/null; then
                    log_info "   ✅ Updated: $name ($install_version)"
                else
                    log_warn "   ⚠️  Update failed, keeping current version"
                fi
            else
                log_debug "   Version matches, no update needed"
            fi
        fi
        INSTALLED_PLUGINS=$((INSTALLED_PLUGINS + 1))
    else
        # プラグインをインストール
        log_info "   Installing..."
        if [ "$install_version" = "latest" ]; then
            if wp plugin install "$slug" --allow-root 2>/dev/null; then
                log_info "   ✅ Installed: $name (latest)"
                INSTALLED_PLUGINS=$((INSTALLED_PLUGINS + 1))
            else
                log_error "   ❌ Failed to install: $name"
                FAILED_PLUGINS=$((FAILED_PLUGINS + 1))
                continue
            fi
        else
            if wp plugin install "$slug" --version="$install_version" --allow-root 2>/dev/null; then
                log_info "   ✅ Installed: $name ($install_version)"
                INSTALLED_PLUGINS=$((INSTALLED_PLUGINS + 1))
            else
                log_error "   ❌ Failed to install: $name ($install_version)"
                FAILED_PLUGINS=$((FAILED_PLUGINS + 1))
                continue
            fi
        fi
    fi

    # 自動有効化
    if [ "$activate" = "true" ]; then
        if wp plugin is-active "$slug" --allow-root 2>/dev/null; then
            log_debug "   Already activated"
            ACTIVATED_PLUGINS=$((ACTIVATED_PLUGINS + 1))
        else
            if wp plugin activate "$slug" --allow-root 2>/dev/null; then
                log_info "   🔌 Activated: $name"
                ACTIVATED_PLUGINS=$((ACTIVATED_PLUGINS + 1))
            else
                log_error "   ❌ Failed to activate: $name"
            fi
        fi
    else
        log_debug "   Auto-activation disabled"
    fi

    log_info ""
done

# 完了レポート
log_info "========================================"
log_info "Installation Summary"
log_info "========================================"
log_info "Total plugins processed: $TOTAL_PLUGINS"
log_info "Successfully installed: $INSTALLED_PLUGINS"
log_info "Activated: $ACTIVATED_PLUGINS"
log_info "Skipped (env mismatch): $SKIPPED_PLUGINS"
log_info "Failed: $FAILED_PLUGINS"
log_info ""

# プレミアムプラグインの案内
log_info "📌 Premium Plugins:"
log_info "   Premium plugins are managed by setup-premium-plugins.sh"
log_info "   They will be installed during container startup"
log_info ""

# 最終確認
log_info "📋 Installed plugins list:"
wp plugin list --allow-root --format=table

log_info ""
log_info "✅ Plugin installation completed!"

# エラーがあった場合は終了コード1を返す
if [ $FAILED_PLUGINS -gt 0 ]; then
    log_error "Some plugins failed to install"
    exit 1
fi

exit 0
