#!/usr/bin/env bash
# migration の deploy 直後に Supabase Advisor (security) を取得し、baseline と比べて
# 新しく増えた lint を数える (deploy-supabase-migrations.yml の staging / production 共通)。
#
# **non-blocking**: どの失敗も exit 0 で終わる (advisor の失敗で deploy の成否を変えない)。
# Slack への送信はしない。呼び出し側が出力を見て .github/actions/slack-notify で送る
# (Slack が未設定でも、チェックと baseline の更新は必ず走るようにするため)。
#
# 入力 (env):
#   SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF / ENV_NAME (staging | production)
#   GH_TOKEN / GH_REPO     baseline artifact の取得に使う (permissions: actions: read)
#
# 出力:
#   $GITHUB_OUTPUT  new_count=<新しく増えた lint 数> / has_new=true|false
#                   比較を終えた時 (baseline が 1 つも無い時を含む) だけ書く。advisor や baseline の取得に
#                   失敗した時・step のタイムアウトで止まった時は書かない (has_new が空になり、呼び出し側は
#                   baseline を更新しない。更新すると、比べられなかった新規の lint が二度と知らされない)
#   current-state.json   今回の状態 (呼び出し側がそのまま upload し、次回の baseline にする)
#   advisor-blocks.json  新しい lint の Block Kit section 配列 (has_new=true の時だけ)
set -uo pipefail

NEW_POST_COUNT=0
COMPARED=false
trap 'if [[ "${COMPARED}" == true && -n "${GITHUB_OUTPUT:-}" ]]; then
  printf "new_count=%s\nhas_new=%s\n" "${NEW_POST_COUNT}" "$([[ "${NEW_POST_COUNT}" != 0 ]] && echo true || echo false)" >> "${GITHUB_OUTPUT}"
fi' EXIT

script_dir="$(cd "$(dirname "$0")" && pwd)"

HTTP_CODE=$(curl -sS --max-time 30 -o post-deploy-advisor.json -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Accept: application/json" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/security") || true
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "::warning title=Post-deploy advisor fetch failed::HTTP ${HTTP_CODE:-000} for ${ENV_NAME}. Deploy result is unaffected, but the advisor snapshot could not be captured."
  exit 0
fi

# lints が配列でない 200 応答を空の state として保存すると、次回に既存の lint が全件「新規」になる
if ! jq -e '.lints | type == "array"' post-deploy-advisor.json >/dev/null 2>&1; then
  echo "::warning title=Post-deploy advisor unexpected shape::lints is not an array for ${ENV_NAME}. The baseline is left unchanged."
  exit 0
fi

# 週次チェック (supabase-advisor-check.yml) と同じ key 化形式 (差分の比較に使うのは lints_by_key のキーだけ)
if ! jq '{ lints_by_key: (.lints | map({key: .cache_key, level, name, detail, remediation}) | INDEX(.key)), count: (.lints | length) }' \
  post-deploy-advisor.json > current-state.json; then
  echo "::warning title=Post-deploy advisor parse failed::Unexpected response shape for ${ENV_NAME}."
  rm -f current-state.json
  exit 0
fi
echo "Post-deploy advisor lint count on ${ENV_NAME}: $(jq -r '.count' current-state.json)"

# baseline = 直近の別実行が保存した advisor-state-<env> (期限切れは除外)。
# ⚠️ fork からの PR は PR 側の workflow 定義で動くため、同じ名前の artifact を置けてしまう。
#    同じリポジトリの実行が保存したものに限り、production は main の実行に限る
#    (偽の baseline で新規 lint の通知を握りつぶされないようにするため)
#    staging は同じリポジトリのどのブランチの実行でもよい (PR ごとの staging deploy が state を残す。意図した割り切り)
filter='.expired == false and .workflow_run.head_repository_id == .workflow_run.repository_id'
if [[ "${ENV_NAME}" == "production" ]]; then
  filter="${filter} and .workflow_run.head_branch == \"main\""
fi
# per_page は上限の 100。少ないと、他ブランチの実行が置いた artifact に押し出されて条件に合うものが見つからない
if ! ARTIFACT_ID=$(gh api "/repos/${GH_REPO}/actions/artifacts?name=advisor-state-${ENV_NAME}&per_page=100" \
  --jq "[.artifacts[] | select(${filter})] | sort_by(.created_at) | reverse | .[0].id // empty" 2>/dev/null); then
  echo "::warning title=Advisor baseline lookup failed::Could not list advisor-state-${ENV_NAME} artifacts. Skipping the diff and keeping the current baseline."
  exit 0
fi
if [[ -z "${ARTIFACT_ID}" ]]; then
  echo "::notice title=Advisor baseline unavailable::No unexpired advisor-state-${ENV_NAME} artifact. Skipping the diff (this run's state becomes the next baseline)."
  COMPARED=true
  exit 0
fi

rm -rf baseline baseline.zip
if ! gh api "/repos/${GH_REPO}/actions/artifacts/${ARTIFACT_ID}/zip" > baseline.zip 2>/dev/null \
  || ! unzip -q -o baseline.zip -d baseline/ \
  || ! jq -e '.lints_by_key | type == "object"' baseline/current-state.json >/dev/null 2>&1; then
  # 形式が不正な baseline と比べると、既存の lint が全件「新規」扱いになりメンションが飛ぶ
  echo "::warning title=Advisor baseline download failed::Could not use artifact ${ARTIFACT_ID} on ${ENV_NAME}. Skipping the diff and keeping the current baseline."
  exit 0
fi

# baseline に無いキーの lint = 今回のデプロイで増えた lint
jq --slurpfile b baseline/current-state.json \
  '[.lints_by_key | to_entries[] | select(.key as $k | $b[0].lints_by_key | has($k) | not) | .value]' \
  current-state.json > new-post-lints.json
count=$(jq length new-post-lints.json)
COMPARED=true
echo "New lints introduced by this deploy on ${ENV_NAME}: ${count}"

if [[ "${count}" == "0" ]]; then
  echo "::notice title=No advisor regression::Deploy did not introduce new advisor lints on ${ENV_NAME}."
  exit 0
fi

if ! jq --arg label "🆕 新規 (デプロイ後)" --argjson max 5 --argjson remediation true \
  -f "${script_dir}/advisor-lint-sections.jq" new-post-lints.json > advisor-blocks.json; then
  echo "::warning title=Advisor blocks build failed::Could not build Slack blocks for ${ENV_NAME}."
  rm -f advisor-blocks.json
fi
if [[ "${count}" -gt 5 && -f advisor-blocks.json ]]; then
  jq --arg more "_…ほか $((count - 5)) 件_" \
    '. + [{ type: "context", elements: [{ type: "mrkdwn", text: $more }] }]' \
    advisor-blocks.json > advisor-blocks.tmp && mv advisor-blocks.tmp advisor-blocks.json
fi

echo "::warning title=Post-deploy advisor regression::Deploy introduced ${count} new lint(s) on ${ENV_NAME}."
NEW_POST_COUNT="${count}"
exit 0
