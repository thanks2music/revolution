#!/usr/bin/env bash
# occurrence 取り込みの結果から、Slack 通知の内容を組み立てる
# (.github/workflows/ingest-occurrences.yml から呼ばれる)。ネットワークには出ない。
#
# 入力 (env):
#   JOB_STATUS        job.status (success / failure / cancelled)
#   INGEST_OUTCOME    steps.ingest.outcome (取り込みの step まで進まなければ空か skipped)
#   DRY_RUN           true なら送らない (人が dispatch して結果を見ている)
#   QUEUE_ACTIONABLE  対応が要る人手キューの対象の数 } ingest-occurrences.ts が計画の時点で
#   QUEUE_WARNINGS    非ブロッキングの対象の数       } step output に書く (数え方は
#   QUEUE_BREAKDOWN   reason ごとの内訳              } plan-ingest.ts の summarizeQueue)。計画の前で落ちると空
#   TARGET            取り込み先の表示名 (staging など)
#
# 出力 ($GITHUB_OUTPUT):
#   notify (true|false)、text / body。送る時は常にメンションする (workflow 側で付ける)
#
# 送るのは「取り込みが失敗・中断した時」と「対応が要る人手キューがある時」。非ブロッキングだけなら
# 送らない (Job Summary には残る)。取り込みは毎回全件を対象にするため、未解決のキューは
# 記事のマージのたびに再び届く。キューの中身 (会場名など) は載せず、件数と reason の内訳だけを載せる。
set -euo pipefail

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "notify=false" >> "${GITHUB_OUTPUT}"
  exit 0
fi

runbook='運用手順書 occurrence-ingest-runbook'
actionable="${QUEUE_ACTIONABLE:-0}"
warnings="${QUEUE_WARNINGS:-0}"
# 数字でない値で (( )) が落ちると、この step が失敗して job も失敗扱いになり、通知も送られない
[[ "${actionable}" =~ ^[0-9]+$ ]] || actionable=0
[[ "${warnings}" =~ ^[0-9]+$ ]] || warnings=0
queue_line=''
if (( actionable > 0 )); then
  queue_line="*人手キュー*: 対応が要る ${actionable} 件 (${QUEUE_BREAKDOWN:-})"
  if (( warnings > 0 )); then queue_line+=" · 非ブロッキング ${warnings} 件"; fi
elif (( warnings > 0 )); then
  queue_line="*人手キュー*: 非ブロッキング ${warnings} 件"
fi

text=''
if [[ "${INGEST_OUTCOME}" == "success" ]]; then
  # 取り込みは終わっている。対応が要るキューが無ければ、後続の step の結果によらず送らない
  if (( actionable > 0 )); then
    text="⚠️ occurrence の取り込みで、対応が要る人手キューが ${actionable} 件あります (${TARGET})"
    action="*対応*: Job Summary と artifact \`ingest-queue-report\` で対象を確かめ、reason ごとに対処してから再実行する (${runbook} の「人手キューの捌き方」)"
    if [[ "${JOB_STATUS}" != "success" ]]; then
      action+=$'\n''*注意*: 取り込みの後の step が失敗または中断した。artifact が無ければ Job Summary で確かめる'
    fi
  fi
elif [[ "${INGEST_OUTCOME}" == "failure" ]]; then
  text="❌ occurrence の取り込みが失敗しました (${TARGET})"
  # step の timeout-minutes に当たった時も failure になる (cancelled ではない。2026-10-04 実測)
  action="*対応*: ログと Job Summary で原因 (タイムアウトを含む) を確かめ、直してから再実行する。取り込みは冪等で、event 単位の失敗なら他の event は取り込み済み (${runbook} の「失敗時の対応」)"
elif [[ "${INGEST_OUTCOME}" == "cancelled" ]]; then
  text="⏹️ occurrence の取り込みが中断されました (${TARGET})"
  action='*対応*: 途中までの書き込みが残っている可能性がある。取り込みは冪等なので、再実行すれば揃う'
elif [[ "${JOB_STATUS}" == "cancelled" ]]; then
  text="⏹️ occurrence の取り込みが、開始する前に中断されました (${TARGET})"
  action='*対応*: 書き込みは行っていない。必要なら再実行する'
else
  # 取り込みの step まで進まなかった (前の step が失敗した)
  text="❌ occurrence の取り込みを開始できませんでした (${TARGET})"
  action='*対応*: 書き込みは行っていない。ログで失敗した step を確かめる'
fi

if [[ -z "${text}" ]]; then
  echo "notify=false" >> "${GITHUB_OUTPUT}"
  exit 0
fi
{
  echo "notify=true"
  echo "text=${text}"
  # body は改行を含むため、複数行の出力形式で書く
  echo "body<<EOF_BODY"
  if [[ -n "${queue_line}" ]]; then echo "${queue_line}"; fi
  echo "${action}"
  echo "EOF_BODY"
} >> "${GITHUB_OUTPUT}"
