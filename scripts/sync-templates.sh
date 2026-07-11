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

# =====================================
# 破壊的操作の事前確認 (2026-07-12 追加)
# =====================================
# rsync --delete で revolution 側 apps/ai-writer/templates/ を Templates 側の
# 内容で上書きするため、Templates 側の branch/commit と revolution 側の
# 現状を明示 + BOSS 明示 y 確認を要求する。
#
# 発端: 2026-07-12 Sprint C-α 着手時、Templates side feature branch と
# revolution 側派生コピーが sync 経由で乖離していたことを発見。今後は
# 誰が sync を実行しても事前確認を強制することで再発防止。
#
# --force-yes フラグ (CI/CD 等の非対話環境用) がある場合は確認スキップ。
FORCE_YES=false
for arg in "$@"; do
    if [[ "$arg" == "--force-yes" ]]; then
        FORCE_YES=true
    fi
done

log_warning "===== sync:templates は rsync --delete で revolution 側を上書きします ====="
log_warning "同期元 (Templates 側 branch): $(cd "$TEMPLATES_SOURCE_PATH" && git branch --show-current 2>/dev/null || echo 'unknown')"
log_warning "同期元 latest commit: $(cd "$TEMPLATES_SOURCE_PATH" && git log -1 --oneline 2>/dev/null || echo 'unknown')"
if [[ -d "$DEST_DIR" ]]; then
    log_warning "同期先 (revolution 側) 現状: $(find "$DEST_DIR" -name '*.yaml' -type f 2>/dev/null | wc -l | tr -d ' ') YAML ファイル"
else
    log_warning "同期先 (revolution 側) 現状: ディレクトリ未作成"
fi
if [[ -f "$DEST_DIR/VERSION.json" ]]; then
    log_warning "前回 sync: $(cat "$DEST_DIR/VERSION.json")"
else
    log_warning "前回 sync: VERSION.json 不在 = 履歴不明"
fi
log_warning "続行前に Templates main と revolution 側の整合性を確認してください"

if [[ "$FORCE_YES" == "false" ]]; then
    read -p "続行しますか? [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_error "sync:templates をキャンセルしました"
        exit 1
    fi
else
    log_info "--force-yes フラグ検知、確認プロンプトをスキップします"
fi

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

# -----------------------------------
# config ディレクトリの同期
# -----------------------------------
# 同期先は templates/config（テンプレートのコンフィグファイルとして整理）
CONFIG_SOURCE_PATH="$TEMPLATES_SOURCE_PATH/ai-writer/config"
CONFIG_DEST_PATH="$DEST_DIR/config"

if [[ -d "$CONFIG_SOURCE_PATH" ]]; then
    log_info "同期中: config ディレクトリ"

    # ディレクトリが存在しない場合は作成
    if [[ ! -d "$CONFIG_DEST_PATH" ]]; then
        mkdir -p "$CONFIG_DEST_PATH"
    fi

    # YAMLファイルのみを同期（.md ファイルは除外）
    rsync -av \
        --include="*.yaml" \
        --exclude="*.md" \
        --exclude="*" \
        "$CONFIG_SOURCE_PATH/" \
        "$CONFIG_DEST_PATH/"

    config_count=$(find "$CONFIG_DEST_PATH" -name "*.yaml" -type f | wc -l | tr -d ' ')
    log_success "config 同期完了: ${config_count}個のYAMLファイル"
else
    log_warning "config ディレクトリが見つかりません: $CONFIG_SOURCE_PATH"
fi

# 同期統計情報
log_info "同期統計情報："
for template in "${MODULAR_TEMPLATES[@]}"; do
    DEST_PATH="$DEST_DIR/$template"
    if [[ -d "$DEST_PATH" ]]; then
        yaml_count=$(find "$DEST_PATH" -name "*.yaml" -type f | wc -l | tr -d ' ')
        echo "  $template: ${yaml_count}個のYAMLファイル"
    fi
done

# config ディレクトリの統計
if [[ -d "$CONFIG_DEST_PATH" ]]; then
    config_yaml_count=$(find "$CONFIG_DEST_PATH" -name "*.yaml" -type f | wc -l | tr -d ' ')
    echo "  config: ${config_yaml_count}個のYAMLファイル"
fi

# VERSION.json の更新 (2026-07-12 改善: 初期作成 + branch/commit 情報記録)
VERSION_FILE="$DEST_DIR/VERSION.json"
CURRENT_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SOURCE_BRANCH=$(cd "$TEMPLATES_SOURCE_PATH" && git branch --show-current 2>/dev/null || echo "unknown")
SOURCE_COMMIT=$(cd "$TEMPLATES_SOURCE_PATH" && git rev-parse HEAD 2>/dev/null || echo "unknown")
SOURCE_COMMIT_SHORT=$(cd "$TEMPLATES_SOURCE_PATH" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

if command -v jq &> /dev/null; then
    if [[ -f "$VERSION_FILE" ]]; then
        # 既存 file を更新
        jq --arg date "$CURRENT_DATE" \
           --arg branch "$SOURCE_BRANCH" \
           --arg commit "$SOURCE_COMMIT" \
           --arg commit_short "$SOURCE_COMMIT_SHORT" \
           '.lastSynced = $date | .sourceBranch = $branch | .sourceCommit = $commit | .sourceCommitShort = $commit_short' \
           "$VERSION_FILE" > "${VERSION_FILE}.tmp" && mv "${VERSION_FILE}.tmp" "$VERSION_FILE"
        log_info "VERSION.json を更新しました (branch=$SOURCE_BRANCH, commit=$SOURCE_COMMIT_SHORT)"
    else
        # 初期作成
        cat > "$VERSION_FILE" <<VERSION_EOF
{
  "lastSynced": "$CURRENT_DATE",
  "sourceBranch": "$SOURCE_BRANCH",
  "sourceCommit": "$SOURCE_COMMIT",
  "sourceCommitShort": "$SOURCE_COMMIT_SHORT",
  "syncedBy": "$USER"
}
VERSION_EOF
        log_info "VERSION.json を新規作成しました (branch=$SOURCE_BRANCH, commit=$SOURCE_COMMIT_SHORT)"
    fi
else
    log_warning "jq が見つからないため VERSION.json は更新されません"
fi

log_success "テンプレート同期が完了しました！"
