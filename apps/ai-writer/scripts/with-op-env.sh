#!/usr/bin/env bash
# 1Password の参照を解決してからコマンドを実行する (無ければそのまま実行する)
#
# 使い方: bash scripts/with-op-env.sh <command> [args...]
#   例: bash scripts/with-op-env.sh tsx scripts/debug-mdx-url.ts --dry-run <URL>
#
# - apps/ai-writer/.env.op.local に `KEY=op://<vault>/<item>/<field>` を書いておくと、
#   `op run` が実行時に値を解決して環境変数として渡す (値はディスクに書かれない)
# - .env.op.local か op CLI が無ければ、注意を 1 行出してコマンドをそのまま実行する。
#   Slack 通知などの任意機能が動かないだけで、本体の処理は止めない
# - 実行中のスクリプトが読む .env.local (dotenv, override なし) より、
#   op run が渡した値が優先される
set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.op.local"

if [[ -f "$ENV_FILE" ]] && command -v op >/dev/null 2>&1; then
  # exec の後には何も出せないので、失敗した時の逃げ道を先に案内しておく
  echo "ℹ️  1Password の参照を解決して実行します (ロック中などで失敗する時は :raw のスクリプトで通知なしに実行できます)" >&2
  exec op run --env-file="$ENV_FILE" -- "$@"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ℹ️  .env.op.local が無いため 1Password の参照を解決せずに実行します (Slack 通知なし)" >&2
else
  echo "ℹ️  op CLI が見つからないため 1Password の参照を解決せずに実行します (Slack 通知なし)" >&2
fi
exec "$@"
