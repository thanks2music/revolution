#!/usr/bin/env bash
# 定期実行 (schedule) の失敗を、成功から失敗に変わった最初の 1 回だけ知らせるための判定
# (.github/workflows/notify-main-failures.yml から呼ばれる)。
#
# 入力 (env): RUN_FILE (失敗した run の JSON)、GH_REPO / GH_TOKEN
# 出力 ($GITHUB_OUTPUT): skip=true|false
#
# - 定期実行でなければ skip=false (push の失敗は毎回知らせる)
# - 1 つ前 (今回より前に作られた、main の完了した実行) が失敗系なら skip=true
#   cancelled も失敗系に数える。job のタイムアウトは cancelled として届くため、数えないと止まっている間
#   30 分ごとに鳴る (手で cancel した直後の失敗が 1 回抑えられるのは許容する)
# - 失敗系以外 (success・skipped など) や、調べられなかった時は skip=false (黙るより重複の方がよい)
set -euo pipefail

skip=false
if [[ "$(jq -r '.event // ""' "${RUN_FILE}")" == "schedule" ]]; then
  workflow_id="$(jq -r '.workflow_id // ""' "${RUN_FILE}")"
  created="$(jq -r '.created_at // ""' "${RUN_FILE}")"
  previous=unknown
  if [[ "${workflow_id}" =~ ^[0-9]+$ ]]; then
    # 定期実行だけを見る (手での dispatch は notify-main-failures の対象外なので、その失敗で抑えると黙ってしまう)。
    # 今回より前に作られたものだけを見る (今回自身と、今回より新しい実行を除く)。5 件で足りなければ "none" になり、送る側に倒れる
    previous="$(gh api "/repos/${GH_REPO}/actions/workflows/${workflow_id}/runs?branch=main&event=schedule&status=completed&per_page=5" 2>/dev/null \
      | jq -r --arg created "${created}" '[.workflow_runs[] | select(.created_at < $created)][0].conclusion // "none"')" \
      || previous=unknown
  fi
  if [[ "${previous}" =~ ^(failure|timed_out|startup_failure|cancelled)$ ]]; then
    echo "::notice::The previous scheduled run also ended with ${previous}. Not notifying again until it succeeds."
    skip=true
  fi
fi
echo "skip=${skip}" >> "${GITHUB_OUTPUT}"
