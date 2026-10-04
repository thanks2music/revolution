#!/usr/bin/env bash
# main で失敗した workflow run の情報から、Slack 通知の内容を組み立てる
# (.github/workflows/notify-main-failures.yml から呼ばれる)。ネットワークには出ない。
#
# 入力 (env):
#   RUN_FILE    gh api /repos/<repo>/actions/runs/<id> の JSON
#   JOBS_FILE   gh api /repos/<repo>/actions/runs/<id>/jobs の JSON
#   REPO_URL    https://github.com/<owner>/<repo> (commit へのリンクに使う)
#
# 出力 ($GITHUB_OUTPUT):
#   text   要約 (改行なし)。エスケープは slack-notify action が行うので、ここではしない
#   body   補足 (生の mrkdwn として送られる)。run 由来の値は & < > をエスケープ済み、改行なし
#          (job 名の "Type Check & Lint" のように & を含む値がある)
set -euo pipefail

jq -r -n \
  --slurpfile run "${RUN_FILE}" \
  --slurpfile jobs "${JOBS_FILE}" \
  --arg repo "${REPO_URL}" '
  def oneline: tostring | gsub("[\r\n]+"; " ");
  def esc: oneline | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");

  $run[0] as $r
  | [($jobs[0].jobs // [])[]
      | select(.conclusion | IN("failure", "timed_out", "startup_failure", "cancelled"))
      | .name | esc] as $failed_jobs
  | ($r.head_sha // "") as $sha
  | [
      (if ($sha | test("^[0-9a-f]{7,40}$")) then
         "*Commit*: <" + $repo + "/commit/" + $sha + "|" + $sha[0:7] + ">"
       else empty end),
      (if ($failed_jobs | length) > 0 then
         "*失敗した job*: " + ($failed_jobs[0:5] | join(", "))
         + (if ($failed_jobs | length) > 5 then " ほか \(($failed_jobs | length) - 5) 件" else "" end)
       else empty end),
      (if ($r.html_url // "") != "" then "*ログ*: <" + ($r.html_url | esc) + "|失敗した実行を開く>" else empty end),
      (if $r.event == "schedule" then "*定期実行*: 次に成功するまで、続く失敗は知らせない" else empty end)
    ] as $parts
  | "text=❌ main で「" + ($r.name // "unknown" | oneline) + "」が失敗しました (" + ($r.conclusion // "unknown" | oneline) + ")",
    "body=" + ($parts | join(" · "))
' >> "${GITHUB_OUTPUT}"
