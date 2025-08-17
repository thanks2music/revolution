#!/bin/bash
# 有料プラグインのセットアップスクリプト（統合版）
# WordPress管理画面での手動ライセンス設定を前提とした管理方式

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 環境変数
PREMIUM_STORAGE_BUCKET=${PREMIUM_STORAGE_BUCKET:-""}
WP_CONTENT_DIR=${WP_CONTENT_DIR:-"/var/www/html/wp-content"}

# プレミアムプラグインのリスト
# key: プラグインディレクトリ名, value: ZIPファイル名
declare -A PREMIUM_PLUGINS=(
    ["atc-plg"]="amtp.zip"
    ["aspn"]="aspn.zip"
    # 必要に応じて追加のプラグインを記載
)

# ==========================================
# 方法1: Google Cloud Storage からダウンロード
# ==========================================
download_from_gcs() {
    local plugin_name=$1
    local file_name=$2
    
    if [ -z "$PREMIUM_STORAGE_BUCKET" ]; then
        log_warn "PREMIUM_STORAGE_BUCKET not set, skipping GCS download"
        return 1
    fi
    
    log_info "Downloading $plugin_name from GCS..."
    
    # gsutil を使用してダウンロード
    if command -v gsutil &> /dev/null; then
        gsutil cp "gs://${PREMIUM_STORAGE_BUCKET}/premium-plugins/${file_name}" \
            "${WP_CONTENT_DIR}/plugins/${file_name}"
    else
        # Cloud Run 環境では Application Default Credentials を使用
        curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
            "https://storage.googleapis.com/storage/v1/b/${PREMIUM_STORAGE_BUCKET}/o/premium-plugins%2F${file_name}?alt=media" \
            -o "${WP_CONTENT_DIR}/plugins/${file_name}"
    fi
    
    # 解凍
    cd "${WP_CONTENT_DIR}/plugins"
    unzip -q "${file_name}"
    rm "${file_name}"
    
    log_info "$plugin_name installed from GCS"
}

# ==========================================
# 方法2: ローカルディレクトリからコピー
# ==========================================
copy_from_local() {
    local plugin_name=$1
    local file_name=$2
    # ローカル開発環境用のパス（Dockerコンテナ内）
    local local_dir="/var/www/html/premium-plugins"
    # macOS上の実際のパス: apps/backend/premium-plugins/
    
    if [ -f "${local_dir}/${file_name}" ]; then
        log_info "Copying $plugin_name from local directory..."
        cp "${local_dir}/${file_name}" "${WP_CONTENT_DIR}/plugins/"
        
        cd "${WP_CONTENT_DIR}/plugins"
        unzip -q "${file_name}"
        rm "${file_name}"
        
        log_info "$plugin_name installed from local"
        return 0
    else
        log_warn "$file_name not found in local directory"
        return 1
    fi
}

# ==========================================
# ライセンス設定ガイド生成
# ==========================================
setup_license_guide() {
    log_info "Creating license setup guide..."
    
    cat > "${WP_CONTENT_DIR}/mu-plugins/premium-license-guide.php" << 'PHP'
<?php
/**
 * Premium Plugin License Setup Guide
 * 
 * このファイルは有料プラグインのライセンス設定方法を
 * WordPress管理画面に表示します。
 */

// 管理画面にライセンス設定ガイドを追加
add_action('admin_notices', function() {
    $screen = get_current_screen();
    
    // プラグイン一覧ページでのみ表示
    if ($screen && $screen->id === 'plugins') {
        $needs_license = [];
        
        // WordPress Automatic Plugin のライセンス状態をチェック
        if (is_plugin_active('atc-plg/wp-automatic.php')) {
            $wp_automatic_license = get_option('wp_automatic_license');
            if (empty($wp_automatic_license)) {
                $needs_license[] = 'WordPress Automatic Plugin';
            }
        }
        
        // WordPress Auto Spinner のライセンス状態をチェック  
        if (is_plugin_active('aspn/wp-auto-spinner.php')) {
            $wp_spinner_license = get_option('wp_auto_spinner_license');
            if (empty($wp_spinner_license)) {
                $needs_license[] = 'WordPress Auto Spinner';
            }
        }
        
        if (!empty($needs_license)) {
            echo '<div class="notice notice-warning is-dismissible">';
            echo '<p><strong>ライセンス設定が必要なプラグインがあります:</strong></p>';
            echo '<ul>';
            foreach ($needs_license as $plugin) {
                echo '<li>' . esc_html($plugin) . '</li>';
            }
            echo '</ul>';
            echo '<p>各プラグインの設定画面からライセンスキーを入力してください。</p>';
            echo '</div>';
        }
    }
});

// プラグイン一覧にライセンス状態を表示
add_filter('plugin_row_meta', function($plugin_meta, $plugin_file) {
    if ($plugin_file === 'atc-plg/wp-automatic.php') {
        $license = get_option('wp_automatic_license');
        $status = empty($license) ? 
            '<span style="color: #d63638;">ライセンス未設定</span>' : 
            '<span style="color: #00a32a;">ライセンス設定済み</span>';
        $plugin_meta[] = 'ライセンス状態: ' . $status;
    }
    
    if ($plugin_file === 'aspn/wp-auto-spinner.php') {
        $license = get_option('wp_auto_spinner_license');
        $status = empty($license) ? 
            '<span style="color: #d63638;">ライセンス未設定</span>' : 
            '<span style="color: #00a32a;">ライセンス設定済み</span>';
        $plugin_meta[] = 'ライセンス状態: ' . $status;
    }
    
    return $plugin_meta;
}, 10, 2);
PHP
}

# ==========================================
# メイン処理
# ==========================================
log_info "Starting premium plugins setup..."

mkdir -p "${WP_CONTENT_DIR}/plugins"

for plugin_name in "${!PREMIUM_PLUGINS[@]}"; do
    file_name="${PREMIUM_PLUGINS[$plugin_name]}"
    
    # 既にインストール済みかチェック
    if [ -d "${WP_CONTENT_DIR}/plugins/${plugin_name}" ]; then
        log_info "$plugin_name is already installed"
        continue
    fi
    
    # 複数の方法を試行（ローカル → Cloud Storage の順）
    if ! copy_from_local "$plugin_name" "$file_name"; then
        if ! download_from_gcs "$plugin_name" "$file_name"; then
            log_warn "Failed to install $plugin_name from any source"
        fi
    fi
done

# ライセンス設定ガイドを生成
setup_license_guide

log_info "✅ Premium plugins setup completed!"
log_info ""
log_info "📋 ライセンス設定について:"
log_info "  有料プラグインのライセンスキーは WordPress 管理画面から手動で設定してください。"
log_info "  - WordPress Automatic: 設定 → WordPress Automatic"
log_info "  - WordPress Auto Spinner: プラグイン設定画面"
log_info "  - 管理画面でライセンス状態の確認も可能です"

# 権限設定
if id -u www-data >/dev/null 2>&1; then
    chown -R www-data:www-data "${WP_CONTENT_DIR}/plugins"
fi