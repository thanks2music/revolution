#!/bin/bash
# git worktree 初期化スクリプト
# main repo の gitignored ローカル設定を worktree に複製する。
# setup-worktree.sh から呼ばれるほか、main 側の YAML 等を更新したあと
# 既存 worktree に反映する単体実行の用途も想定する。
#
# Usage:
#   bash scripts/worktree-init.sh [--dry-run] <worktree-path>
#
# Example:
#   bash scripts/worktree-init.sh .claude/worktrees/feat-foo
#   bash scripts/worktree-init.sh --dry-run .claude/worktrees/feat-foo
#
# 仕様:
# - main repo 内からのみ実行可 (worktree 内では reject)
# - rsync -a (no --delete) で冪等性確保
#   既存ファイルは追加・更新、worktree 側で生まれたファイルは保護
# - SYNC_PATHS 内のディレクトリが main 側に存在しない場合は skip (warn のみ)
# - REQUIRED_FILES は post-condition で存在確認、不在なら exit 1
# - --dry-run で rsync -n -v による実行確認のみ (書き込みなし)

set -euo pipefail

# ----- 必須コマンドの存在チェック (rsync) -----
# Copilot / claude[bot] review (PR #225): set -e 下では generic な
# "command not found" になり原因が分かりづらいため、明示的に fail-fast する
if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required but not found in PATH" >&2
  echo "  Install: brew install rsync (macOS) / apt install rsync (Debian/Ubuntu)" >&2
  exit 1
fi

# ----- 引数 / dry-run 処理 -----
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

if [[ $# -lt 1 ]]; then
  echo "Error: worktree path required" >&2
  echo "Usage: bash scripts/worktree-init.sh [--dry-run] <worktree-path>" >&2
  exit 1
fi

WORKTREE_PATH="$1"

# ----- main repo root 検出 (setup-worktree.sh と同じパターン) -----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GIT_DIR="$(git -C "$MAIN_ROOT" rev-parse --git-dir)"
GIT_COMMON_DIR="$(git -C "$MAIN_ROOT" rev-parse --git-common-dir)"
if [[ "$GIT_DIR" != "$GIT_COMMON_DIR" ]]; then
  echo "Error: must be run from the main repository (not from a worktree)" >&2
  echo "  Current dir: $MAIN_ROOT" >&2
  exit 1
fi

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "Error: worktree directory not found: $WORKTREE_PATH" >&2
  exit 1
fi

# 絶対パスへ正規化 (相対指定でも安全に rsync が動くように)
WORKTREE_PATH="$(cd "$WORKTREE_PATH" && pwd)"

# ----- 同期対象ホワイトリスト -----
# 末尾 / は付けない (rsync で src と dst に共通の末尾 / を付与するため)
SYNC_PATHS=(
  "apps/ai-writer/config"
  "apps/ai-writer/templates"
  ".jarvis"
)

# ----- 必須ファイル (post-condition assert 対象) -----
# husky pre-push の MediaTypeMapperService 初期化に必須
REQUIRED_FILES=(
  "apps/ai-writer/config/media-type-mapping.yaml"
)

# ----- rsync オプション -----
# -a: archive (-rlptgoD)。permission/timestamp/symlink を保持
# --delete を付けない: worktree 側で生まれたファイルを保護 (冪等性)
RSYNC_OPTS=(-a)
if [[ "$DRY_RUN" == "true" ]]; then
  RSYNC_OPTS+=(-n -v)
fi

echo "================================================================"
echo " worktree-init"
echo "================================================================"
echo "  Main repo:     $MAIN_ROOT"
echo "  Worktree:      $WORKTREE_PATH"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "  Mode:          dry-run (no changes)"
fi
echo "================================================================"
echo ""

# ----- 同期実行 -----
for rel in "${SYNC_PATHS[@]}"; do
  src="$MAIN_ROOT/$rel"
  dst="$WORKTREE_PATH/$rel"

  if [[ ! -e "$src" ]]; then
    echo "  [skip] $rel (main 側に存在しない、想定内)"
    continue
  fi

  # ファイルやリンクで誤って作られているケースを skip。
  # Copilot review (PR #225): rsync 直前に -d 確認しないと中途半端な
  # state (例: .jarvis が誤ってファイル作成) で全体 abort してしまう
  if [[ ! -d "$src" ]]; then
    echo "  [skip] $rel (main 側がディレクトリではない、想定外)" >&2
    continue
  fi

  # 親ディレクトリを事前作成 (rsync -a は親ディレクトリを作らない)
  dst_parent="$(dirname "$dst")"
  if [[ "$DRY_RUN" == "true" ]]; then
    # claude[bot] review (PR #225): dry-run では mkdir を skip するが
    # rsync -n が dst 親無しで失敗するため、新規 worktree への pre-flight として
    # 「作成予定」を可視化する
    [[ ! -d "$dst_parent" ]] && echo "  [would mkdir] $dst_parent"
  else
    mkdir -p "$dst_parent"
  fi

  # 末尾 / 付きの src/dst で「ディレクトリ中身を同名ディレクトリへ複製」を表現
  rsync "${RSYNC_OPTS[@]}" "$src/" "$dst/"
  echo "  [sync] $rel"
done

echo ""

# ----- post-condition: 必須ファイル assert -----
if [[ "$DRY_RUN" != "true" ]]; then
  for req in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "$WORKTREE_PATH/$req" ]]; then
      echo "ERROR: required file missing after sync: $req" >&2
      echo "  main repo 側に $MAIN_ROOT/$req が無い可能性があります。" >&2
      echo "  husky pre-push の MediaTypeMapperService 初期化に必須のファイルです。" >&2
      exit 1
    fi
  done
fi

echo "✅ worktree-init complete"
