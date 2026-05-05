#!/bin/bash
# worktree 削除スクリプト
# git worktree remove + ブランチ削除 (対話確認) を行う。
#
# Usage:
#   bash scripts/worktree-cleanup.sh <dir-name>
#
# Example:
#   bash scripts/worktree-cleanup.sh refactor-pipeline

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/worktree-cleanup.sh <dir-name>" >&2
  echo "Example: bash scripts/worktree-cleanup.sh refactor-pipeline" >&2
  exit 1
fi

DIR_NAME="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_PATH="$MAIN_ROOT/.claude/worktrees/$DIR_NAME"

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "Error: worktree directory not found: $WORKTREE_PATH" >&2
  exit 1
fi

# main 側からのみ実行可能 (worktree 内で実行すると自分自身を消そうとする)
GIT_DIR="$(git -C "$MAIN_ROOT" rev-parse --git-dir)"
GIT_COMMON_DIR="$(git -C "$MAIN_ROOT" rev-parse --git-common-dir)"
if [[ "$GIT_DIR" != "$GIT_COMMON_DIR" ]]; then
  echo "Error: must be run from the main repository (not from a worktree)" >&2
  exit 1
fi

BRANCH_NAME="$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD)"

echo "Removing worktree:"
echo "  Path:   $WORKTREE_PATH"
echo "  Branch: $BRANCH_NAME"
echo ""

# setup-worktree.sh が生成した既知ファイル (gitignore 対象) を先に削除
# こうすることで git worktree remove が untracked を理由に拒否しない一方、
# ユーザーが追加した未コミット変更があれば worktree remove が安全側に倒れる
GENERATED_FILES=(
  "$WORKTREE_PATH/.worktree.env"
  "$WORKTREE_PATH/apps/ai-writer/firebase.worktree.json"
  "$WORKTREE_PATH/.env.local"
  "$WORKTREE_PATH/apps/ai-writer/.env.local"
  "$WORKTREE_PATH/apps/ai-writer/.env.deploy"
  "$WORKTREE_PATH/apps/frontend/.env.local"
  "$WORKTREE_PATH/apps/frontend/.env.production.local"
)
for f in "${GENERATED_FILES[@]}"; do
  if [[ -L "$f" ]] || [[ -e "$f" && ! -d "$f" ]]; then
    rm -f "$f"
  fi
done

git -C "$MAIN_ROOT" worktree remove "$WORKTREE_PATH"
echo "✅ worktree removed"
echo ""

read -r -p "ブランチ '$BRANCH_NAME' も削除しますか？ [y/N]: " REPLY
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  git -C "$MAIN_ROOT" branch -d "$BRANCH_NAME"
  echo "✅ ブランチ削除完了"
else
  echo "ブランチは残しました: $BRANCH_NAME"
fi
