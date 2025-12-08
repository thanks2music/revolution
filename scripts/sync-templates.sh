#!/bin/bash

# テンプレート同期スクリプト
# プライベートリポジトリ（revolution-templates）から
# パブリックリポジトリ（revolution）へテンプレートを同期

set -e

# 環境変数読み込み
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT_DIR/.env.local"

if [[ -f "$ENV_FILE" ]]; then
    set -o allexport
    source "$ENV_FILE"
    set +o allexport
else
    echo -e "\033[0;31m[ERROR]\033[0m .env.local ファイルが見つかりません: $ENV_FILE"
    echo "以下の環境変数を設定してください："
    echo "  TEMPLATES_SOURCE_PATH=\"/path/to/revolution-templates\""
    exit 1
fi

# 環境変数の確認
if [[ -z "$TEMPLATES_SOURCE_PATH" ]]; then
    echo -e "\033[0;31m[ERROR]\033[0m TEMPLATES_SOURCE_PATH 環境変数が設定されていません"
    echo ".env.local に以下を追加してください："
    echo "  TEMPLATES_SOURCE_PATH=\"/path/to/revolution-templates\""
    exit 1
fi

# 色付きログ出力
log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

log_warning() {
    echo -e "\033[0;33m[WARNING]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1"
}

# 同期先パス
DEST_DIR="$PROJECT_ROOT_DIR/apps/ai-writer/templates"

# メイン処理開始
log_info "テンプレート同期を開始します..."
log_info "同期元: $TEMPLATES_SOURCE_PATH"
log_info "同期先: $DEST_DIR"

# 同期元ディレクトリの確認
if [[ ! -d "$TEMPLATES_SOURCE_PATH" ]]; then
    log_error "テンプレートソースディレクトリが見つかりません: $TEMPLATES_SOURCE_PATH"
    exit 1
fi

# 同期先ディレクトリの確認・作成
if [[ ! -d "$DEST_DIR" ]]; then
    log_warning "同期先ディレクトリが存在しません。作成します: $DEST_DIR"
    mkdir -p "$DEST_DIR"
fi

# 同期対象テンプレート一覧（モジュール化テンプレート）
MODULAR_TEMPLATES=(
    "collabo-cafe"
)

# 各モジュール化テンプレートを同期
for template in "${MODULAR_TEMPLATES[@]}"; do
    SOURCE_PATH="$TEMPLATES_SOURCE_PATH/ai-writer/posts/yaml/$template"
    DEST_PATH="$DEST_DIR/$template"

    if [[ -d "$SOURCE_PATH" ]]; then
        log_info "同期中: $template"

        # ディレクトリごと同期（--deleteで削除されたファイルも反映）
        rsync -av --delete \
            "$SOURCE_PATH/" \
            "$DEST_PATH/"

        # 同期されたファイル数を数える
        file_count=$(find "$DEST_PATH" -name "*.yaml" -type f | wc -l | tr -d ' ')
        log_success "$template 同期完了: ${file_count}個のYAMLファイル"
    else
        log_warning "テンプレートが見つかりません: $SOURCE_PATH"
    fi
done

# 同期統計情報
log_info "同期統計情報："
for template in "${MODULAR_TEMPLATES[@]}"; do
    DEST_PATH="$DEST_DIR/$template"
    if [[ -d "$DEST_PATH" ]]; then
        yaml_count=$(find "$DEST_PATH" -name "*.yaml" -type f | wc -l | tr -d ' ')
        echo "  $template: ${yaml_count}個のYAMLファイル"
    fi
done

# VERSION.json の更新
VERSION_FILE="$DEST_DIR/VERSION.json"
if [[ -f "$VERSION_FILE" ]]; then
    # jqが利用可能な場合は更新
    if command -v jq &> /dev/null; then
        CURRENT_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        jq --arg date "$CURRENT_DATE" '.lastSynced = $date' "$VERSION_FILE" > "${VERSION_FILE}.tmp" && mv "${VERSION_FILE}.tmp" "$VERSION_FILE"
        log_info "VERSION.json を更新しました"
    fi
fi

log_success "テンプレート同期が完了しました！"
