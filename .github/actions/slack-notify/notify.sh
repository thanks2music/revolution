#!/usr/bin/env bash
# Slack へ chat.postMessage で 1 通送る (.github/actions/slack-notify から呼ばれる)。
#
# **どんな失敗でも exit 0 で終わる。** 通知の失敗で、呼び出し元の job の結果
# (デプロイの成否など) を変えないため。失敗は ::warning:: で残す。
#
# ⚠️ Web API はエラーでも HTTP 200 + {"ok": false, "error": ...} を返すため、
#    HTTP ステータスではなく本文の ok で成否を判定する
#    (https://docs.slack.dev/reference/methods/chat.postMessage)。
# ⚠️ public repo の Actions ログは GitHub にログインした誰でも読める。payload と
#    レスポンス本文はログに出さず、エラーコードだけを出す。
# リトライはしない (タイムアウト後に Slack 側で受理済みだった場合に二重投稿になるため)。
set -uo pipefail

ok=false
skipped=false
tmp="$(mktemp -d)"
# どの経路で終わっても一時ファイルを消し、結果 (ok / skipped) を step の outputs に残す
trap 'rm -rf "${tmp}"; if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf "ok=%s\nskipped=%s\n" "${ok}" "${skipped}" >> "${GITHUB_OUTPUT}"; fi' EXIT

channel="${SLACK_CHANNEL:-}"
mention="${NOTIFY_MENTION:-}"
prefix=''

# テストモード: 明示指定、または main 以外の ref での workflow_dispatch (auto-test-mode が有効な時)
if [[ "${NOTIFY_TEST:-false}" == "true" ]] \
  || { [[ "${NOTIFY_AUTO_TEST:-true}" == "true" ]] \
    && [[ "${NOTIFY_EVENT_NAME:-}" == "workflow_dispatch" ]] \
    && [[ "${NOTIFY_REF:-}" != "refs/heads/main" ]]; }; then
  channel="${SLACK_TEST_CHANNEL:-}"
  mention=''
  prefix='[TEST] '
  echo "Slack notify: test mode (posting to the test channel without a mention)"
fi

if [[ -z "${SLACK_TOKEN:-}" || -z "${channel}" ]]; then
  # fork からの PR や secret 未登録の環境では正常に起こる。失敗扱いにしない
  echo "::notice title=Slack notify skipped::SLACK_BOT_TOKEN or the channel ID is not set."
  skipped=true
  exit 0
fi

payload_file="${tmp}/payload.json"
response_file="${tmp}/response.json"
text_only_file="${tmp}/text-only.json"

post() {
  curl -sS --max-time 15 -o "${response_file}" -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer ${SLACK_TOKEN}" \
    -H 'Content-Type: application/json; charset=utf-8' \
    --data-binary "@$1" \
    https://slack.com/api/chat.postMessage
}

response_ok() {
  [[ "$(jq -r '.ok // false' "${response_file}" 2>/dev/null)" == "true" ]]
}

# ::warning:: の行に出すため、英数字と _ 以外は落とす (改行 + :: 記法によるコマンド注入を防ぐ)
response_error() {
  local code
  code="$(jq -r '.error // empty' "${response_file}" 2>/dev/null | tr -cd 'a-zA-Z0-9_' || true)"
  echo "${code:-invalid_response_http_${1:-000}}"
}

run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"

if ! PAYLOAD_CHANNEL="${channel}" \
  PAYLOAD_TEXT="${NOTIFY_TEXT:-}" \
  PAYLOAD_PREFIX="${prefix}" \
  PAYLOAD_MENTION="${mention}" \
  PAYLOAD_BODY="${NOTIFY_BODY:-}" \
  PAYLOAD_BLOCKS_FILE="${NOTIFY_BLOCKS_FILE:-}" \
  PAYLOAD_RUN_URL="${run_url}" \
  bash "$(dirname "$0")/build-payload.sh" > "${payload_file}"; then
  echo "::warning title=Slack notification failed::could not build the payload"
  exit 0
fi

http_code="$(post "${payload_file}")" || true
if response_ok; then
  ok=true
  echo "Slack notification sent"
  exit 0
fi
# 本文が JSON でない (プロキシのエラーページ等) / 接続できなかった場合も区別して残す
error_code="$(response_error "${http_code}")"

# blocks が拒否された時 (invalid_blocks / msg_too_long) は何も投稿されていないので、
# 要約 (text、メンションを含む) と実行ログへのリンクだけで 1 回だけ送り直す。二重投稿にはならず、要対応の知らせは届く
if [[ "${error_code}" == "invalid_blocks" || "${error_code}" == "msg_too_long" ]]; then
  jq --arg run "${run_url}" \
    '{channel, text: (.text + "\n<" + $run + "|実行ログ (GitHub Actions)>"), unfurl_links, unfurl_media}' \
    "${payload_file}" > "${text_only_file}"
  http_code="$(post "${text_only_file}")" || true
  if response_ok; then
    ok=true
    echo "::warning title=Slack notification degraded::${error_code}. Sent the summary only."
    exit 0
  fi
  error_code="$(response_error "${http_code}")"
fi

echo "::warning title=Slack notification failed::${error_code}"
exit 0
