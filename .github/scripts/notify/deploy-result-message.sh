#!/usr/bin/env bash
# AI Writer の Cloud Run デプロイ結果から、Slack 通知の内容を組み立てる
# (.github/workflows/deploy-ai-writer.yml から呼ばれる)。ネットワークには出ない。
#
# 入力 (env):
#   JOB_STATUS      job.status (success / failure / cancelled)
#   DEPLOY_OUTCOME  steps.deploy.outcome (success なら新しいリビジョンが出ている)
#   HEALTH_OUTCOME  steps.health.outcome
#   HTTP_CODE       health check の最後の HTTP ステータス (無ければ空)
#   PINNED          true なら、新しいリビジョンにトラフィックが流れていない (以前のリビジョンに固定されている)
#   TRAFFIC_CHECKED true なら、トラフィックの割り当てを確かめられた (describe が失敗すると空)
#   COMMIT_URL      commit のページの URL
#   COMMIT_SHA      commit の SHA (表示は先頭 7 文字)
#
# 出力 ($GITHUB_OUTPUT):
#   text / body / mention (true|false)
#
# サービス名とリージョンは GitHub の secret のため Slack には載せない (値は運用手順書)。
# body は生の mrkdwn として送られるので、手順の <サービス名> などは &lt; &gt; で書く
# (そのまま書くと Slack がリンク記法として解釈して表示が崩れる)。
set -euo pipefail

svc='&lt;サービス名&gt;'
region='&lt;リージョン&gt;'
commit="*Commit*: <${COMMIT_URL}|${COMMIT_SHA:0:7}>"
unpin="\`gcloud run services update-traffic ${svc} --region ${region} --to-latest\`"
rollback="*ロールバック*: \`gcloud run revisions list --service ${svc} --region ${region}\` で直前のリビジョンを確かめ、\`gcloud run services update-traffic ${svc} --region ${region} --to-revisions &lt;直前のリビジョン&gt;=100\`。直した版をデプロイする前に ${unpin} で固定を解く (固定したままだと、次のデプロイのトラフィックが 0% になる)"
http=''
if [[ "${HTTP_CODE:-}" =~ ^[0-9]{3}$ ]]; then
  http=" · *HTTP*: ${HTTP_CODE}"
fi

mention=true
if [[ "${JOB_STATUS}" == "success" ]]; then
  mention=false
  text='✅ AI Writer を Cloud Run にデプロイしました'
  body="${commit}"
elif [[ "${PINNED:-}" == "true" ]]; then
  text='⚠️ AI Writer: 新しいリビジョンにトラフィックが流れていません (以前のリビジョンに固定中)'
  body="${commit}"$'\n'"*解除*: 新しいリビジョンの動作を確かめてから ${unpin}"
elif [[ "${DEPLOY_OUTCOME}" == "success" && "${TRAFFIC_CHECKED:-}" != "true" ]]; then
  # deploy は終わったが、サービスの状態を取得できなかった。どのリビジョンが動いているか断定しない
  text='⚠️ AI Writer: デプロイ後の状態を確かめられませんでした (トラフィックの割り当てとヘルスチェックを確認してください)'
  body="${commit}"$'\n'"*確認*: \`gcloud run services describe ${svc} --region ${region}\` でトラフィックの割り当てを確かめる"
elif [[ "${DEPLOY_OUTCOME}" == "success" ]]; then
  # deploy は終わり、割り当ても確かめた (固定なし) ので、新しいリビジョンがトラフィック 100% で動いている
  if [[ "${HEALTH_OUTCOME}" == "failure" ]]; then
    text='❌ AI Writer: 新しいリビジョンのヘルスチェックに失敗しました (新リビジョンがトラフィック 100% で稼働中)'
  else
    text='⏹️ AI Writer: デプロイ後の確認が完了しませんでした (新リビジョンがトラフィック 100% で稼働中)'
  fi
  body="${commit}${http}"$'\n'"${rollback}"
else
  if [[ "${JOB_STATUS}" == "cancelled" ]]; then
    text='⏹️ AI Writer のデプロイが中断されました (以前のリビジョンが稼働中)'
  else
    text='❌ AI Writer のデプロイが完了しませんでした (以前のリビジョンが稼働中)'
  fi
  body="${commit}"
fi

{
  echo "text=${text}"
  echo "mention=${mention}"
  # body は改行を含むため、複数行の出力形式で書く
  echo "body<<EOF_BODY"
  echo "${body}"
  echo "EOF_BODY"
} >> "${GITHUB_OUTPUT}"
