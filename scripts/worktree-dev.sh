#!/bin/bash
# worktree 専用 dev サーバー起動 wrapper
# .worktree.env から port を読み、CLI 引数として直接 next/firebase に渡すことで、
# main 側 package.json (`next dev --port 4444` 等) を無改変のまま port を上書きする。
#
# Usage (must run from inside the worktree):
#   bash scripts/worktree-dev.sh frontend
#   bash scripts/worktree-dev.sh ai-writer
#   bash scripts/worktree-dev.sh emulator

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/worktree-dev.sh <frontend|ai-writer|emulator>" >&2
  exit 1
fi

CMD="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$WORKTREE_ROOT/.worktree.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found" >&2
  echo "  このコマンドは worktree 内で実行してください。" >&2
  echo "  worktree を作成するには main 側で:" >&2
  echo "    bash scripts/setup-worktree.sh <branch-name>" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

case "$CMD" in
  frontend)
    echo "Starting frontend on port $FRONTEND_PORT..."
    cd "$WORKTREE_ROOT/apps/frontend"
    exec pnpm exec next dev --port "$FRONTEND_PORT"
    ;;
  ai-writer)
    echo "Starting ai-writer on port $AI_WRITER_PORT..."
    cd "$WORKTREE_ROOT/apps/ai-writer"
    exec pnpm exec next dev --port "$AI_WRITER_PORT"
    ;;
  emulator)
    FIREBASE_CONFIG="$WORKTREE_ROOT/apps/ai-writer/firebase.worktree.json"
    FIREBASE_CONFIG_NAME="$(basename "$FIREBASE_CONFIG")"
    if [[ ! -f "$FIREBASE_CONFIG" ]]; then
      echo "Error: $FIREBASE_CONFIG not found" >&2
      echo "  考えられる原因:" >&2
      echo "    1. main 側 apps/ai-writer/firebase.json が存在しない" >&2
      echo "       → 元 firebase.json をリポジトリに追加する" >&2
      echo "    2. setup-worktree.sh 実行時に jq が無く生成 skip された" >&2
      echo "       → brew install jq し setup-worktree.sh を再実行 (worktree を作り直し)" >&2
      exit 1
    fi
    echo "Starting Firebase Emulator (auth:$FB_AUTH_PORT, firestore:$FB_FIRESTORE_PORT, storage:$FB_STORAGE_PORT, ui:$FB_UI_PORT)..."
    cd "$WORKTREE_ROOT/apps/ai-writer"
    # firebase-tools は apps/ai-writer の devDependencies に固定されているため、
    # pnpm exec 経由で workspace のバージョンを使う (Copilot review C1)
    exec pnpm exec firebase emulators:start --config "$FIREBASE_CONFIG_NAME"
    ;;
  *)
    echo "Error: unknown command: $CMD" >&2
    echo "Usage: bash scripts/worktree-dev.sh <frontend|ai-writer|emulator>" >&2
    exit 1
    ;;
esac
