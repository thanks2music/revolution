#!/bin/bash
# git worktree 並行作業セットアップスクリプト
# main 側の env ファイル / firebase.json に一切変更を加えず、
# .claude/worktrees/<dir-name> に独立した作業環境を構築する。
#
# Usage:
#   bash scripts/setup-worktree.sh [--skip-install] <branch-name> [base-branch]
#
# Example:
#   bash scripts/setup-worktree.sh refactor/pipeline
#   bash scripts/setup-worktree.sh fix/test-bug main
#   bash scripts/setup-worktree.sh --skip-install test/dry-run main
#
# 仕様:
# - <branch-name> は新規作成。既存ブランチを再利用したい場合は git worktree add を直接使う
# - <base-branch> 省略時は main
# - --skip-install 指定で pnpm install を skip (検証・動作確認用)
# - port offset は worktree dir 名の SHA1 ハッシュから決定 (1000-9000 の 1000 単位)
#   port range: frontend 5444-13444 / ai-writer 8777-16777 / fb auth 10099-18099 /
#               fb firestore 9088-17088 / fb storage 10199-18199 / fb ui 5000-13000
# - main 側の .env.local / firebase.json は無改変、symlink + 独立 firebase.worktree.json で対応

set -euo pipefail

# ----- 引数バリデーション -----
SKIP_INSTALL=false
if [[ "${1:-}" == "--skip-install" ]]; then
  SKIP_INSTALL=true
  shift
fi

if [[ $# -lt 1 ]]; then
  echo "Error: branch name required" >&2
  echo "Usage: bash scripts/setup-worktree.sh [--skip-install] <branch-name> [base-branch]" >&2
  exit 1
fi

BRANCH_NAME="$1"
BASE_BRANCH="${2:-main}"

# ----- SHA1 ハッシャー検出 (macOS: shasum / Linux: sha1sum) -----
if command -v sha1sum >/dev/null 2>&1; then
  sha1_cmd() { sha1sum; }
elif command -v shasum >/dev/null 2>&1; then
  sha1_cmd() { shasum -a 1; }
else
  echo "Error: neither sha1sum (Linux) nor shasum (macOS) is available" >&2
  exit 1
fi

# ----- main repo root 検出 -----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GIT_DIR="$(git -C "$MAIN_ROOT" rev-parse --git-dir)"
GIT_COMMON_DIR="$(git -C "$MAIN_ROOT" rev-parse --git-common-dir)"
if [[ "$GIT_DIR" != "$GIT_COMMON_DIR" ]]; then
  echo "Error: must be run from the main repository (not from a worktree)" >&2
  echo "  Current dir: $MAIN_ROOT" >&2
  exit 1
fi

# ----- worktree dir 名導出 -----
# git branch 名は `:`/`?`/`*`/`[` 等を禁止するが空白・`~`/`^` 等は許される。
# directory 名・shell 安全な文字 (英数 + . _ -) のみ残し、それ以外は - に置換 + 連続 - を 1 つに圧縮
DIR_NAME="$(printf '%s' "$BRANCH_NAME" | tr '/' '-' | tr -cs 'a-zA-Z0-9._-' '-')"
WORKTREE_PATH="$MAIN_ROOT/.claude/worktrees/$DIR_NAME"

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "Error: worktree path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

# ----- port offset 計算 (SHA1 hash ベース、1000-9000 の 1000 単位) -----
HASH_HEX="$(printf '%s' "$DIR_NAME" | sha1_cmd | cut -c 1-8)"
HASH_DEC="$((16#$HASH_HEX))"
OFFSET_INDEX="$(( (HASH_DEC % 9) + 1 ))"
PORT_OFFSET="$((OFFSET_INDEX * 1000))"

FRONTEND_PORT="$((4444 + PORT_OFFSET))"
AI_WRITER_PORT="$((7777 + PORT_OFFSET))"
FB_AUTH_PORT="$((9099 + PORT_OFFSET))"
FB_FIRESTORE_PORT="$((8088 + PORT_OFFSET))"
FB_STORAGE_PORT="$((9199 + PORT_OFFSET))"
FB_UI_PORT="$((4000 + PORT_OFFSET))"

# ----- port 衝突の事前検査 (LISTEN 状態の port が既に使われていないか) -----
PORT_WARNINGS=()
LSOF_SKIPPED=false
if command -v lsof >/dev/null 2>&1; then
  for port in "$FRONTEND_PORT" "$AI_WRITER_PORT" "$FB_AUTH_PORT" "$FB_FIRESTORE_PORT" "$FB_STORAGE_PORT" "$FB_UI_PORT"; do
    if lsof -i "tcp:$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
      PORT_WARNINGS+=("$port")
    fi
  done
else
  LSOF_SKIPPED=true
fi

# ----- 既存 worktree の PORT_OFFSET 衝突検査 -----
# birthday paradox: 9 buckets だと ~4 worktree で 50% 衝突確率
OFFSET_COLLISIONS=()
if compgen -G "$MAIN_ROOT/.claude/worktrees/*/.worktree.env" >/dev/null; then
  for existing_env in "$MAIN_ROOT/.claude/worktrees/"*/.worktree.env; do
    if grep -q "^PORT_OFFSET=$PORT_OFFSET$" "$existing_env" 2>/dev/null; then
      OFFSET_COLLISIONS+=("$(dirname "$existing_env" | xargs basename)")
    fi
  done
fi

echo "================================================================"
echo " git worktree setup"
echo "================================================================"
echo "  Branch:        $BRANCH_NAME (from $BASE_BRANCH)"
echo "  Worktree dir:  $WORKTREE_PATH"
echo "  Port offset:   +$PORT_OFFSET"
echo "    frontend:    $FRONTEND_PORT"
echo "    ai-writer:   $AI_WRITER_PORT"
echo "    fb auth:     $FB_AUTH_PORT"
echo "    fb firestore:$FB_FIRESTORE_PORT"
echo "    fb storage:  $FB_STORAGE_PORT"
echo "    fb ui:       $FB_UI_PORT"
if [[ "$LSOF_SKIPPED" == "true" ]]; then
  echo "  ℹ Skipping port collision check (lsof not found / lsof 未インストール)"
fi
if [[ ${#PORT_WARNINGS[@]} -gt 0 ]]; then
  echo "  ⚠ Port already in use / 使用中: ${PORT_WARNINGS[*]}"
  echo "    Another worktree or process is bound. Setup continues but dev servers will conflict on start."
fi
if [[ ${#OFFSET_COLLISIONS[@]} -gt 0 ]]; then
  echo "  ⚠ PORT_OFFSET=$PORT_OFFSET collides with existing worktree(s): ${OFFSET_COLLISIONS[*]}"
  echo "    Hash buckets are 1000-9000 (9 slots) so collisions are likely past ~4 worktrees."
fi
echo "================================================================"
echo ""

# ----- 失敗時の partial setup ガイド -----
# pnpm install 等で失敗した場合に半端な worktree を残さないため、
# recovery コマンドを案内する。trap は ERR で発動
cleanup_on_error() {
  local rc=$?
  echo "" >&2
  echo "Setup failed (exit $rc). To remove the partial worktree:" >&2
  echo "  bash scripts/worktree-cleanup.sh $DIR_NAME" >&2
}
trap cleanup_on_error ERR

# ----- git worktree add -----
echo "[1/5] git worktree add..."
mkdir -p "$MAIN_ROOT/.claude/worktrees"
git -C "$MAIN_ROOT" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"
echo ""

# ----- env ファイルへの symlink 作成 -----
echo "[2/5] symlink env files..."
ENV_FILES=(
  ".env.local"
  "apps/ai-writer/.env.local"
  "apps/ai-writer/.env.deploy"
  "apps/frontend/.env.local"
  "apps/frontend/.env.production.local"
)

# worktree から main を指す相対パス (リポジトリ全体を移動しても壊れない)
REL_TO_MAIN="../../.."

for relpath in "${ENV_FILES[@]}"; do
  src="$MAIN_ROOT/$relpath"
  dst="$WORKTREE_PATH/$relpath"

  if [[ ! -f "$src" ]]; then
    echo "  [skip] $relpath (main 側に存在しません)"
    continue
  fi

  if [[ -e "$dst" ]]; then
    echo "  [skip] $relpath (worktree 側に既存)"
    continue
  fi

  dst_parent="$(dirname "$dst")"
  if [[ ! -d "$dst_parent" ]]; then
    echo "  [skip] $relpath (worktree 側の親ディレクトリ無し)"
    continue
  fi

  # 各 env ファイルの階層数だけ ../ を積む
  depth="$(echo "$relpath" | tr -cd '/' | wc -c | tr -d ' ')"
  prefix=""
  for ((i=0; i<depth; i++)); do
    prefix="../$prefix"
  done
  rel_src="${prefix}${REL_TO_MAIN}/$relpath"

  ln -s "$rel_src" "$dst"
  echo "  [link] $relpath"
done
echo ""

# ----- firebase.worktree.json 生成 -----
echo "[3/5] generate firebase.worktree.json..."
FIREBASE_SRC="$MAIN_ROOT/apps/ai-writer/firebase.json"
FIREBASE_DST="$WORKTREE_PATH/apps/ai-writer/firebase.worktree.json"

if [[ ! -f "$FIREBASE_SRC" ]]; then
  echo "  [skip] main 側に firebase.json なし"
elif ! command -v jq >/dev/null 2>&1; then
  echo "  [warn] jq が見つかりません (brew install jq)。firebase.worktree.json は手動生成してください"
else
  # .emulators キー存在を事前検証 (jq は欠損キーを無音で作成するため)
  if ! jq -e '.emulators' "$FIREBASE_SRC" >/dev/null 2>&1; then
    echo "  [warn] firebase.json に .emulators キー無し。生成される firebase.worktree.json は構造的に有効でも意味的に正しくない可能性あり"
  fi

  jq \
    --argjson auth "$FB_AUTH_PORT" \
    --argjson firestore "$FB_FIRESTORE_PORT" \
    --argjson storage "$FB_STORAGE_PORT" \
    --argjson ui "$FB_UI_PORT" \
    '.emulators.auth.port = $auth |
     .emulators.firestore.port = $firestore |
     .emulators.storage.port = $storage |
     .emulators.ui.port = $ui |
     .emulators.singleProjectMode = false' \
    "$FIREBASE_SRC" > "$FIREBASE_DST"
  echo "  [gen]  apps/ai-writer/firebase.worktree.json"
fi
echo ""

# ----- .worktree.env 生成 -----
echo "[4/5] generate .worktree.env..."
cat > "$WORKTREE_PATH/.worktree.env" <<EOF
# Auto-generated by scripts/setup-worktree.sh — do not commit
# Worktree: $DIR_NAME
# Branch:   $BRANCH_NAME
# Created:  $(date -u +"%Y-%m-%dT%H:%M:%SZ")

WORKTREE_NAME=$DIR_NAME
PORT_OFFSET=$PORT_OFFSET
FRONTEND_PORT=$FRONTEND_PORT
AI_WRITER_PORT=$AI_WRITER_PORT
FB_AUTH_PORT=$FB_AUTH_PORT
FB_FIRESTORE_PORT=$FB_FIRESTORE_PORT
FB_STORAGE_PORT=$FB_STORAGE_PORT
FB_UI_PORT=$FB_UI_PORT
EOF
echo "  [gen]  .worktree.env"
echo ""

# ----- pnpm install -----
if [[ "$SKIP_INSTALL" == "true" ]]; then
  echo "[5/5] pnpm install ... [skipped (--skip-install)]"
  echo "  → 後で worktree 内で手動実行してください:"
  echo "      cd $WORKTREE_PATH && pnpm install"
  echo "    (setup-worktree.sh の再実行は worktree 既存エラーで失敗します)"
else
  echo "[5/5] pnpm install (3-5 minutes)..."
  (cd "$WORKTREE_PATH" && pnpm install)
fi
echo ""

# ----- 完了メッセージ -----
echo "================================================================"
echo " ✅ Worktree setup complete"
echo "================================================================"
echo ""
echo "次のステップ:"
echo "  cd $WORKTREE_PATH"
echo "  bash scripts/worktree-dev.sh frontend    # http://localhost:$FRONTEND_PORT"
echo "  bash scripts/worktree-dev.sh ai-writer   # http://localhost:$AI_WRITER_PORT"
echo "  bash scripts/worktree-dev.sh emulator    # Firebase UI: http://localhost:$FB_UI_PORT"
echo ""
echo "削除する場合:"
echo "  bash scripts/worktree-cleanup.sh $DIR_NAME"
