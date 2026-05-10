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

# worktree に紐づくブランチを git worktree list --porcelain から取得する
# rev-parse --abbrev-ref HEAD だと detached HEAD で `HEAD` を返したり、
# worktree 内で別ブランチに checkout 済みだと現在のブランチを返してしまう
BRANCH_NAME=""
while IFS= read -r line; do
  case "$line" in
    "worktree $WORKTREE_PATH"*)
      capture=true
      ;;
    "worktree "*)
      capture=false
      ;;
    "branch refs/heads/"*)
      if [[ "${capture:-false}" == "true" ]]; then
        BRANCH_NAME="${line#branch refs/heads/}"
        break
      fi
      ;;
  esac
done < <(git -C "$MAIN_ROOT" worktree list --porcelain)

echo "Removing worktree:"
echo "  Path:   $WORKTREE_PATH"
if [[ -n "$BRANCH_NAME" ]]; then
  echo "  Branch: $BRANCH_NAME"
else
  echo "  Branch: (detached HEAD — branch deletion will be skipped)"
fi
echo ""

# setup-worktree.sh が生成した既知ファイル (gitignore 対象) を先に削除
# こうすることで git worktree remove が untracked を理由に拒否しない一方、
# ユーザーが追加した未コミット変更があれば worktree remove が安全側に倒れる

# (1) setup-worktree.sh が「実体ファイル」として生成するもの
#     存在すれば常に削除可。jq が無くて生成 skip された場合もある
GENERATED_REAL_FILES=(
  "$WORKTREE_PATH/.worktree.env"
  "$WORKTREE_PATH/apps/ai-writer/firebase.worktree.json"
)

# (2) worktree-init.sh が「実体ディレクトリ」として rsync するもの
#     gitignored なため git worktree remove が untracked 拒否しない仕掛け。
#     symlink 化されていれば誤削除回避 (将来運用変更時の安全弁)
GENERATED_REAL_DIRS=(
  "$WORKTREE_PATH/apps/ai-writer/config"
  "$WORKTREE_PATH/apps/ai-writer/templates"
  "$WORKTREE_PATH/.jarvis"
)

# (3) setup-worktree.sh が「symlink」として生成するもの
#     symlink に限定削除し、実体ファイルに置き換えられていれば手動配置の env として保持
GENERATED_SYMLINKS=(
  "$WORKTREE_PATH/.env.local"
  "$WORKTREE_PATH/apps/ai-writer/.env.local"
  "$WORKTREE_PATH/apps/ai-writer/.env.deploy"
  "$WORKTREE_PATH/apps/frontend/.env.local"
  "$WORKTREE_PATH/apps/frontend/.env.production.local"
)

for f in "${GENERATED_REAL_FILES[@]}"; do
  if [[ -e "$f" && ! -d "$f" ]]; then
    rm -f "$f"
  fi
done

for d in "${GENERATED_REAL_DIRS[@]}"; do
  # -d かつ非 symlink を要求: symlink 運用へ変更されていれば誤削除しない
  if [[ -d "$d" && ! -L "$d" ]]; then
    rm -rf "$d"
  fi
done

for f in "${GENERATED_SYMLINKS[@]}"; do
  # -L: symlink (壊れていても true)、-e は壊れた symlink で false なので両方判定
  if [[ -L "$f" ]]; then
    rm -f "$f"
  elif [[ -e "$f" ]]; then
    echo "  [keep] $f (実体ファイル化されているため誤削除回避)"
  fi
done

if ! git -C "$MAIN_ROOT" worktree remove "$WORKTREE_PATH"; then
  echo "" >&2
  echo "  Tip: worktree に未コミットの変更があると拒否されます。" >&2
  echo "       commit/stash するか、強制削除するなら:" >&2
  echo "         git worktree remove --force $WORKTREE_PATH" >&2
  exit 1
fi
echo "✅ worktree removed"
echo ""

# detached HEAD だった場合はブランチ削除プロンプトを skip
if [[ -z "$BRANCH_NAME" ]]; then
  echo "ブランチ削除はスキップしました (detached HEAD)"
  exit 0
fi

read -r -p "ブランチ '$BRANCH_NAME' も削除しますか？ [y/N]: " REPLY
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  # -d (lowercase) は merge 済みでないと拒否する。意図的: 未マージ作業を誤って失わないため
  # 強制削除したい場合はユーザーが明示的に `git branch -D` を実行する
  # `--` でブランチ名を引数として明示的に終端 (`-` 始まりの名前を hyphen-leading option と誤認させない)
  git -C "$MAIN_ROOT" branch -d -- "$BRANCH_NAME"
  echo "✅ ブランチ削除完了"
else
  echo "ブランチは残しました: $BRANCH_NAME"
fi
