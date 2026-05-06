#!/usr/bin/env bash
# Stop hook: 編集ファイル関連の jest テストのみ自動実行する (pre-push hook と同じ --findRelatedTests 方式)。
# - stop_hook_active=true なら即終了 (公式の再帰防止パターン)
# - 最後の人間入力以降の Edit/Write/MultiEdit/NotebookEdit に渡された file_path を抽出
# - apps/ai-writer 配下の .ts/.tsx/.js/.jsx/.mjs/.cjs ファイルがあれば、関連 jest テストのみ実行
# - 失敗時は exit 0 + stdout で結果を Claude のコンテキストに流す (応答 block しない)

set -uo pipefail

# jq が無い環境では Stop hook の "silent" 原則を守るため、即終了する。
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

input="$(cat)"

stop_hook_active=$(jq -r '.stop_hook_active // false' <<<"$input")
if [[ "$stop_hook_active" == "true" ]]; then
  exit 0
fi

transcript_path=$(jq -r '.transcript_path // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")

if [[ -z "$transcript_path" || ! -f "$transcript_path" ]]; then
  exit 0
fi
if [[ -z "$cwd" || ! -d "$cwd" ]]; then
  exit 0
fi

# 最後の人間入力 user (= message.content が string、または text のみの array) 以降に
# 編集系 tool_use があれば、それぞれの file_path を出力する。
edited_files=$(jq -s -r '
  def is_human_user:
    .type == "user"
    and (
      (.message.content | type) == "string"
      or (
        (.message.content | type) == "array"
        and (.message.content | all(.type == "text"))
      )
    );

  (. | to_entries
       | map(select(.value | is_human_user))
       | last
       | (.key // -1)) as $u
  | if $u < 0 then empty
    else
      .[$u + 1 :]
      | map(select(.type == "assistant"))
      | map(.message.content // [])
      | flatten
      | map(select(.type == "tool_use"
                   and (.name == "Edit" or .name == "Write"
                        or .name == "MultiEdit" or .name == "NotebookEdit")))
      | map(.input.file_path // empty)
      | .[] | select(length > 0)
    end
' "$transcript_path")

if [[ -z "$edited_files" ]]; then
  exit 0
fi

ai_writer_root="$cwd/apps/ai-writer"
# Bash 3.2 互換のため連想配列を使わず、`sort -u` で重複排除する。
related_files=()
while IFS= read -r rel; do
  [[ -n "$rel" ]] && related_files+=("$rel")
done < <(
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ "$f" == "$ai_writer_root"/* && "$f" =~ \.(ts|tsx|js|jsx|mjs|cjs)$ ]]; then
      printf '%s\n' "${f#$ai_writer_root/}"
    fi
  done <<<"$edited_files" | sort -u
)

if [[ ${#related_files[@]} -eq 0 ]]; then
  exit 0
fi

cd "$ai_writer_root" || exit 0

output=$(pnpm exec jest --findRelatedTests --passWithNoTests "${related_files[@]}" 2>&1)
status=$?

if [[ $status -eq 0 ]]; then
  exit 0
fi

echo "❌ jest --findRelatedTests failed (exit ${status})."
echo "Edited files: ${related_files[*]}"
echo "Last 80 lines of output:"
echo "---"
echo "$output" | tail -n 80
exit 0
