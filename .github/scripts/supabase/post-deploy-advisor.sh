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
#   $GITHUB_OUTPUT  new_count=<新しく増えた lint 数>
#   post-deploy-state.json  今回の状態 (呼び出し側が current-state.json として upload し、次回の baseline にする)
#   advisor-blocks.json     新しい lint の Block Kit section 配列 (new_count > 0 の時だけ)
set -uo pipefail

NEW_POST_COUNT=0
trap 'if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "new_count=${NEW_POST_COUNT}" >> "${GITHUB_OUTPUT}"; fi' EXIT

script_dir="$(cd "$(dirname "$0")" && pwd)"

HTTP_CODE=$(curl -sS --max-time 30 -o post-deploy-advisor.json -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Accept: application/json" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/security") || true
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "::warning title=Post-deploy advisor fetch failed::HTTP ${HTTP_CODE:-000} for ${ENV_NAME}. Deploy result is unaffected, but the advisor snapshot could not be captured."
  exit 0
fi

# 週次チェック (supabase-advisor-check.yml) と同じ key 化形式
if ! jq '{ lints_by_key: (.lints // [] | map({key: .cache_key, level, name, detail, remediation}) | INDEX(.key)), count: (.lints // [] | length) }' \
  post-deploy-advisor.json > post-deploy-state.json; then
  echo "::warning title=Post-deploy advisor parse failed::Unexpected response shape for ${ENV_NAME}."
  rm -f post-deploy-state.json
  exit 0
fi
echo "Post-deploy advisor lint count on ${ENV_NAME}: $(jq -r '.count' post-deploy-state.json)"

# baseline = 直近の別実行が保存した advisor-state-<env> (期限切れは除外)。
# ⚠️ fork からの PR は PR 側の workflow 定義で動くため、同じ名前の artifact を置けてしまう。
#    同じリポジトリの実行が保存したものに限り、production は main の実行に限る
#    (偽の baseline で新規 lint の通知を握りつぶされないようにするため)
filter='.expired == false and .workflow_run.head_repository_id == .workflow_run.repository_id'
if [[ "${ENV_NAME}" == "production" ]]; then
  filter="${filter} and .workflow_run.head_branch == \"main\""
fi
ARTIFACT_ID=$(gh api "/repos/${GH_REPO}/actions/artifacts?name=advisor-state-${ENV_NAME}&per_page=20" \
  --jq "[.artifacts[] | select(${filter})][0].id // empty" 2>/dev/null || true)
if [[ -z "${ARTIFACT_ID}" ]]; then
  echo "::notice title=Advisor baseline unavailable::No unexpired advisor-state-${ENV_NAME} artifact. Skipping the diff (this run's state becomes the next baseline)."
  exit 0
fi

rm -rf baseline baseline.zip
if ! gh api "/repos/${GH_REPO}/actions/artifacts/${ARTIFACT_ID}/zip" > baseline.zip 2>/dev/null \
  || ! unzip -q -o baseline.zip -d baseline/ \
  || ! jq -e '.lints_by_key | type == "object"' baseline/current-state.json >/dev/null 2>&1; then
  # 形式が不正な baseline と比べると、既存の lint が全件「新規」扱いになりメンションが飛ぶ
  echo "::warning title=Advisor baseline download failed::Could not use artifact ${ARTIFACT_ID} on ${ENV_NAME}. Skipping the diff."
  exit 0
fi

jq -r '.lints_by_key | keys[]' baseline/current-state.json | sort > baseline-keys.txt
jq -r '.lints_by_key | keys[]' post-deploy-state.json | sort > post-keys.txt
comm -23 post-keys.txt baseline-keys.txt > new-post-keys.txt
count=$(wc -l < new-post-keys.txt | tr -d ' ')
echo "New lints introduced by this deploy on ${ENV_NAME}: ${count}"

if [[ "${count}" == "0" ]]; then
  echo "::notice title=No advisor regression::Deploy did not introduce new advisor lints on ${ENV_NAME}."
  exit 0
fi

jq --slurpfile keys <(jq -R -s 'split("\n") | map(select(length > 0))' new-post-keys.txt) \
  '.lints_by_key | to_entries | map(select(.key as $k | $keys[0] | index($k))) | map(.value)' \
  post-deploy-state.json > new-post-lints.json

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
