#!/usr/bin/env bash
# Vercel が送る repository_dispatch の client_payload から、Slack 通知の内容を組み立てる
# (.github/workflows/vercel-deploy-notify.yml から呼ばれる)。ネットワークには出ない。
#
# 入力 (env):
#   EVENT_ACTION   github.event.action (vercel.deployment.success / error / failed)
#   PAYLOAD_FILE   github.event.client_payload を書き出した JSON ファイル
#                  (形式: https://github.com/vercel/repository-dispatch の src/data/*.ts)
#   PROJECT_NAME   通知の対象にする Vercel プロジェクト名
#   REPO_URL       https://github.com/<owner>/<repo> (commit へのリンクに使う)
#   BLOCKS_FILE    補足 (URL / commit / branch / 失敗の理由) を書き出す Block Kit のファイル
#
# 出力 ($GITHUB_OUTPUT):
#   notify=true|false      送るかどうか。送らないもの: 対象外のプロジェクト、Preview の成功、
#                          デプロイの削除 (error / deployment_deleted)、Preview での権限起因の失敗
#                          (authorization_required など。Vercel にアクセスできない人の commit で起きる)
#   production=true|false  本番環境のデプロイか (true なら本番系、false なら開発系へ送る)
#   mention=true|false     メンションするか (本番環境の失敗だけ)
#   test=true|false        テストモードで送るか (疑似イベントの client_payload.test。真偽値でも文字列でもよい)
#   text                   要約 (payload 由来の値を含まない)
# 出力 (ファイル):
#   $BLOCKS_FILE           補足の section 1 つ (空なら [])。payload 由来の値は & < > をエスケープ済み、改行なし。
#                          composite action の with: の値は public なログに出るため、body ではなくファイルで渡す
set -euo pipefail

out="$(mktemp)"
jq -r \
  --arg action "${EVENT_ACTION}" \
  --arg project "${PROJECT_NAME}" \
  --arg repo "${REPO_URL}" '
  def oneline: tostring | gsub("[\r\n]+"; " ");
  def esc: oneline | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
  # エスケープ後に切るので、末尾の欠けた entity (&am など) を落とす
  def trunc($n): if length > $n then (.[0:($n - 1)] | sub("&[a-z]{0,4}$"; "")) + "…" else . end;

  ((.environment // "") == "production") as $production
  | (.state.type // "") as $state
  | (.state.detail // "") as $detail
  # error / deployment_deleted はデプロイの削除で、失敗ではない
  | ($state == "error" and $detail == "deployment_deleted") as $deleted
  | ($action != "vercel.deployment.success" and ($deleted | not)) as $failed
  | ($detail | IN("authorization_required", "missing_vercel_access", "no_vercel_account")) as $access
  | (((.project.name // "") == $project)
     and (if $production then ($action == "vercel.deployment.success" or $failed)
          else ($failed and ($access | not)) end)) as $notify
  | (if $production then "本番" else "Preview" end) as $env_label
  | (.git.sha // "") as $sha
  | [
      # url はスキームなしで届くことがある
      (if (.url // "") != "" then
         ((.url | tostring) as $u | (if ($u | test("^https?://")) then $u else "https://" + $u end))
         # リンク記法の区切りになる | は %7C にする
         | gsub("\\|"; "%7C")
         as $href | "*URL*: <" + ($href | esc) + "|" + ($href | sub("^https?://"; "") | esc) + ">"
       else empty end),
      (if ($sha | test("^[0-9a-f]{7,40}$")) then
         "*Commit*: <" + $repo + "/commit/" + $sha + "|" + $sha[0:7] + ">"
       else empty end),
      # バッククォートで囲むので、ref の中のバッククォートはシングルクォートにする
      (if (.git.ref // "") != "" then "*Branch*: `" + (.git.ref | gsub("`"; "\u0027") | esc | trunc(100)) + "`" else empty end),
      (if $failed then
         "*状態*: " + ((.state.type // "unknown") | esc)
         + (if $detail != "" then " (" + ($detail | esc) + ")" else "" end)
       else empty end),
      (if $failed and (.error // "") != "" then "*理由*: " + (.error | esc | trunc(300)) else empty end)
    ] as $parts
  | "notify=\($notify)",
    "production=\($production)",
    "mention=\($production and $failed)",
    "test=\((.test // false) | tostring == "true")",
    "text=" + (if $failed
               then "❌ フロントエンドの\($env_label)デプロイが失敗しました (Vercel)"
               else "✅ フロントエンドを本番にデプロイしました (Vercel)" end),
    "body=" + ($parts | join(" · "))
' "${PAYLOAD_FILE}" > "${out}"

grep -v '^body=' "${out}" >> "${GITHUB_OUTPUT}"
grep '^body=' "${out}" | sed 's/^body=//' \
  | jq -Rs 'rtrimstr("\n") | if . == "" then [] else [{type: "section", text: {type: "mrkdwn", text: .}}] end' \
  > "${BLOCKS_FILE}"
rm -f "${out}"
