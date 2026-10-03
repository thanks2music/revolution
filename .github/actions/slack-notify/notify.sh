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
# trap (EXIT) から呼ぶ。shellcheck は trap 経由の呼び出しを追えないため info を抑止する
# shellcheck disable=SC2329
write_outputs() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "ok=${ok}"
      echo "skipped=${skipped}"
    } >> "${GITHUB_OUTPUT}"
  fi
}
trap write_outputs EXIT

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

payload_file="$(mktemp)"
response_file="$(mktemp)"
trap 'rm -f "${payload_file}" "${response_file}"; write_outputs' EXIT

if ! PAYLOAD_CHANNEL="${channel}" \
  PAYLOAD_TEXT="${NOTIFY_TEXT:-}" \
  PAYLOAD_PREFIX="${prefix}" \
  PAYLOAD_MENTION="${mention}" \
  PAYLOAD_BODY="${NOTIFY_BODY:-}" \
  PAYLOAD_BLOCKS_FILE="${NOTIFY_BLOCKS_FILE:-}" \
  PAYLOAD_RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}" \
  bash "$(dirname "$0")/build-payload.sh" > "${payload_file}"; then
  echo "::warning title=Slack notification failed::could not build the payload"
  exit 0
fi

http_code="$(curl -sS --max-time 15 -o "${response_file}" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer ${SLACK_TOKEN}" \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary "@${payload_file}" \
  https://slack.com/api/chat.postMessage)" || true

if [[ "$(jq -r '.ok // false' "${response_file}" 2>/dev/null)" == "true" ]]; then
  ok=true
  echo "Slack notification sent"
  exit 0
fi

# 本文が JSON でない (プロキシのエラーページ等) / 接続できなかった場合も区別して残す
error_code="$(jq -r '.error // empty' "${response_file}" 2>/dev/null || true)"
if [[ -z "${error_code}" ]]; then
  error_code="invalid_response_http_${http_code:-000}"
fi
echo "::warning title=Slack notification failed::${error_code}"
exit 0
