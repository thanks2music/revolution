#!/bin/bash

# ドキュメント作成＋自動同期ヘルパースクリプト
# Claudeでドキュメントを作成した後、自動的にiCloudに同期
# iCloudディレクトリ: We Are All One/Revolution

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

# PROJECT_ROOT の解決順 (3 段フォールバック、sync-docs-to-icloud.sh と同一パターン):
#   1. git rev-parse --show-toplevel — 第一手段 (hardcoded path 依存を排除、main / worktree 双方で正しく解決)
#   2. .env.local の PROJECT_ROOT — 非 git context 限定の後方互換 fallback
#   3. スクリプト位置から派生した PROJECT_ROOT_DIR — 最終フォールバック
# 2026-07-06: one-more-time 子 dir 化に伴う stale `.env.local` PROJECT_ROOT 問題への恒久対応。
#             sync-docs-to-icloud.sh と同一の 3-tier 解決パターン (根本原因バグが両スクリプトに存在)。
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

# 使用方法を表示
show_usage() {
    echo "使用方法:"
    echo "  $0 <docs|notes> <relative_path>"
    echo ""
    echo "例:"
    echo "  $0 docs README.md"
    echo "  $0 notes 01-project-docs/00-meta/META-04-new-rule.md"
    echo ""
    echo "  docs: パブリックドキュメント (docs/)"
    echo "  notes: プライベートノート (notes/)"
}

# 引数チェック
if [[ $# -ne 2 ]]; then
    show_usage
    exit 1
fi

DOC_TYPE="$1"
RELATIVE_PATH="$2"

# 色付きログ出力
log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1"
}

# ドキュメントタイプの検証
if [[ "$DOC_TYPE" != "docs" && "$DOC_TYPE" != "notes" ]]; then
    log_error "無効なドキュメントタイプ: $DOC_TYPE"
    show_usage
    exit 1
fi

# PROJECT_ROOT は既に環境変数から読み込み済み

# ファイルパス生成
if [[ "$DOC_TYPE" == "docs" ]]; then
    FULL_PATH="$PROJECT_ROOT/docs/$RELATIVE_PATH"
    log_info "📄 パブリックドキュメントを確認: $RELATIVE_PATH"
elif [[ "$DOC_TYPE" == "notes" ]]; then
    FULL_PATH="$PROJECT_ROOT/notes/$RELATIVE_PATH"
    log_info "📝 プライベートノートを確認: $RELATIVE_PATH"
fi

# ファイル存在確認
if [[ ! -f "$FULL_PATH" ]]; then
    log_error "ファイルが見つかりません: $FULL_PATH"
    log_info "Claudeでドキュメントを作成してから、このスクリプトを実行してください。"
    exit 1
fi

log_success "✅ ドキュメントが確認されました"

# ファイル情報表示
if [[ "$(uname)" == "Darwin" ]]; then
    # macOS
    FILE_SIZE=$(stat -f%z "$FULL_PATH" 2>/dev/null || wc -c < "$FULL_PATH")
else
    # Linux
    FILE_SIZE=$(stat -c%s "$FULL_PATH" 2>/dev/null || wc -c < "$FULL_PATH")
fi
FILE_LINES=$(wc -l < "$FULL_PATH")
log_info "📊 ファイル情報: ${FILE_SIZE}バイト, ${FILE_LINES}行"

# 自動同期実行
log_info "🔄 iCloudへの同期を開始..."

# 同期スクリプト実行
"$PROJECT_ROOT/scripts/sync-docs-to-icloud.sh"

log_success "🎉 完了！iPadで確認できます。"

# iPad用のパス情報表示（相対パスで表示）
if [[ "$DOC_TYPE" == "docs" ]]; then
    IPAD_PATH="We Are All One/Revolution/docs/$RELATIVE_PATH"
elif [[ "$DOC_TYPE" == "notes" ]]; then
    IPAD_PATH="We Are All One/Revolution/notes/$RELATIVE_PATH"
fi

log_info "📱 iPad MWebでのパス: $IPAD_PATH"