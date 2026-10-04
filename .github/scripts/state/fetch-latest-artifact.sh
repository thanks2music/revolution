#!/usr/bin/env bash
# 同じリポジトリの main の実行が保存した、名前の一致する最新の artifact を取り出す。
# 前回の実行の状態を artifact で引き継ぐ workflow から呼ぶ (permissions: actions: read が要る)。
#
# 使い方: fetch-latest-artifact.sh <artifact 名> <取り出し先のディレクトリ>
# 入力 (env): GH_TOKEN / GH_REPO
# 出力 ($GITHUB_OUTPUT): found=true|false
#
# - fork の PR は PR 側の workflow 定義で動くため、同じ名前の artifact を置けてしまう。同じリポジトリの、
#   main の実行が置いたものだけを使う
# - 一覧は新しい順 (id の降順) に返るので、1 ページ目 (100 件) に最新が入る。sentry-digest は 30 分ごと ×
#   保存 2 日 = 約 96 個なので足りるが、頻度か保存期間を増やす時は、main 以外の実行が置く分も含めて見直す
# - 一覧や zip の取得に失敗したら exit 1 にする (「無い」と同じに扱うと、呼び出し側が前回の状態を失ったものとして
#   動き、送り直しなどをしてしまう)。zip が壊れている時だけは「無い」として扱う
#
# TODO: supabase-advisor-check.yml と post-deploy-advisor.sh も同じ処理を持つ (取得の失敗を握りつぶす版)。
#       移すなら、失敗を許すかどうかを引数で選べるようにする
set -euo pipefail

name="$1"
dest="$2"
filter='.expired == false and .workflow_run.head_repository_id == .workflow_run.repository_id and .workflow_run.head_branch == "main"'

id="$(gh api "/repos/${GH_REPO}/actions/artifacts?name=${name}&per_page=100" \
  --jq "[.artifacts[] | select(${filter})] | max_by(.created_at) | .id // empty")"
if [[ -z "${id}" ]]; then
  echo "::notice::No unexpired ${name} artifact from main."
  echo "found=false" >> "${GITHUB_OUTPUT}"
  exit 0
fi

gh api "/repos/${GH_REPO}/actions/artifacts/${id}/zip" > "${dest}.zip"
if ! unzip -q -o "${dest}.zip" -d "${dest}"; then
  echo "::warning::Could not unzip ${name} (artifact ${id}). Treating it as missing."
  echo "found=false" >> "${GITHUB_OUTPUT}"
  exit 0
fi
rm -f "${dest}.zip"
echo "found=true" >> "${GITHUB_OUTPUT}"
