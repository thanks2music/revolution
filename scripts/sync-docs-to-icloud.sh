#!/bin/bash

# Revolution ドキュメント自動同期スクリプト
# iPadでの閲覧用にiCloudドライブに同期

set -e

# 環境変数読み込み
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT_DIR/.env.local"

if [[ -f "$ENV_FILE" ]]; then
    # .env.localから環境変数を読み込み
    set -o allexport
    source "$ENV_FILE"
    set +o allexport
else
    echo -e "\033[0;31m[ERROR]\033[0m .env.local ファイルが見つかりません: $ENV_FILE"
    echo "以下の環境変数を設定してください："
    echo "  PROJECT_ROOT=\"/path/to/your/revolution\""
    echo "  ICLOUD_DRIVE_PATH=\"/path/to/your/icloud/revolution\""
    exit 1
fi

# PROJECT_ROOT の解決順 (3 段フォールバック):
#   1. git rev-parse --show-toplevel — hardcoded path 依存を排除する第一手段
#      (main / worktree 双方で正しく repo root を返す、Todoist 6gqXXxgW9WxQj3h8 推奨方針)
#   2. .env.local の PROJECT_ROOT — 後方互換 (明示上書き)
#   3. スクリプト位置から派生した PROJECT_ROOT_DIR — .env.local 不在 / git 外の最終フォールバック
# 2026-07-06: one-more-time 子 dir 化に伴う hardcoded path 起因の post-commit 失敗事案 (2026-06-10 PR #244)
#             の恒久対応として、git rev-parse を第一候補化。
PROJECT_ROOT_GIT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -n "$PROJECT_ROOT_GIT" ]] && [[ -d "$PROJECT_ROOT_GIT" ]]; then
    PROJECT_ROOT="$PROJECT_ROOT_GIT"
elif [[ -z "$PROJECT_ROOT" ]] || [[ ! -d "$PROJECT_ROOT" ]]; then
    if [[ -n "$PROJECT_ROOT" ]] && [[ ! -d "$PROJECT_ROOT" ]]; then
        echo -e "\033[0;33m[WARNING]\033[0m PROJECT_ROOT (\"$PROJECT_ROOT\") が存在しません。スクリプト位置から自動派生した \"$PROJECT_ROOT_DIR\" を使用します。"
    fi
    PROJECT_ROOT="$PROJECT_ROOT_DIR"
fi

if [[ -z "$ICLOUD_DRIVE_PATH" ]]; then
    echo -e "\033[0;31m[ERROR]\033[0m ICLOUD_DRIVE_PATH 環境変数が設定されていません"
    exit 1
fi

# 設定
ICLOUD_BASE="$ICLOUD_DRIVE_PATH"

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

# メイン処理開始
log_info "📚 Revolution ドキュメント同期を開始します..."

# プロジェクトルートディレクトリの確認
if [[ ! -d "$PROJECT_ROOT" ]]; then
    log_error "プロジェクトルートが見つかりません: $PROJECT_ROOT"
    exit 1
fi

# iCloudディレクトリの確認・作成
if [[ ! -d "$ICLOUD_BASE" ]]; then
    log_warning "iCloudディレクトリが存在しません。作成します: $ICLOUD_BASE"
    mkdir -p "$ICLOUD_BASE"
fi

# iCloudディレクトリ構造を作成
mkdir -p "$ICLOUD_BASE/docs"
# notes ディレクトリは iCloud Drive に移動させたため、コメントアウト
# mkdir -p "$ICLOUD_BASE/notes"

log_info "📄 パブリックドキュメント（docs/）を同期中..."

# docs/ の同期（.mdファイルのみ）
if [[ -d "$PROJECT_ROOT/docs" ]]; then
    # .mdファイルのみを同期（ディレクトリ構造も保持）
    rsync -av --delete \
        --include='*/' \
        --include='*.md' \
        --exclude='*' \
        "$PROJECT_ROOT/docs/" \
        "$ICLOUD_BASE/docs/"

    # 同期されたファイル数を数える
    docs_count=$(find "$ICLOUD_BASE/docs" -name "*.md" -type f | wc -l)
    log_success "パブリックドキュメント同期完了: ${docs_count}個のMarkdownファイル"
else
    log_warning "docs/ディレクトリが見つかりません"
fi

# notes ディレクトリは iCloud Drive に移動させたため、コメントアウト
# log_info "📝 プライベートノート（notes/）を同期中..."
#
# # notes/ の同期（.mdファイルのみ）
# if [[ -d "$PROJECT_ROOT/notes" ]]; then
#     # .mdファイルのみを同期（ディレクトリ構造も保持）
#     rsync -av --delete \
#         --include='*/' \
#         --include='*.md' \
#         --exclude='*' \
#         "$PROJECT_ROOT/notes/" \
#         "$ICLOUD_BASE/notes/"
#
#     # 同期されたファイル数を数える
#     notes_count=$(find "$ICLOUD_BASE/notes" -name "*.md" -type f | wc -l)
#     log_success "プライベートノート同期完了: ${notes_count}個のMarkdownファイル"
# else
#     log_warning "notes/ディレクトリが見つかりません"
# fi

# 同期統計情報
log_info "📊 同期統計情報："
echo "  📁 パブリック: $(find "$ICLOUD_BASE/docs" -name "*.md" -type f | wc -l | tr -d ' ')個のファイル"
# notes ディレクトリは iCloud Drive に移動させたため、コメントアウト
# echo "  📝 プライベート: $(find "$ICLOUD_BASE/notes" -name "*.md" -type f | wc -l | tr -d ' ')個のファイル"
echo "  💾 同期先: $ICLOUD_BASE"

# 最新の同期時刻を記録
echo "Last sync: $(date)" > "$ICLOUD_BASE/.last-sync"

log_success "✅ Revolution ドキュメント同期が完了しました！"
log_info "💡 iPadのMWebアプリで確認できます。"
