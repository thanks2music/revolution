#!/usr/bin/env bash
# Sentry の issue 一覧 API から、直近 WINDOW_HOURS 時間に新しく出た issue と、いま回帰中の issue を取得する
# (.github/workflows/sentry-digest.yml から呼ばれる)。
# https://docs.sentry.io/api/events/list-an-organizations-issues/
#
# 入力 (env):
#   SENTRY_API_TOKEN  Internal Integration の token (Issue & Event: Read だけで足りる)
#   SENTRY_ORG        organization の slug
#   WINDOW_HOURS      既定 24 (1〜720)。毎回この期間を見直す (届いたかどうかは sentry-digest-message.sh が
#                     「知らせ済み」の記録で判断するので、重なった分は送らない)
#
# 出力:
#   $GITHUB_OUTPUT  window_start / truncated (true|false)
#   ファイル        prod-new.json / prod-regressed.json / other-new.json / other-regressed.json
#                   (要るフィールドだけの配列。タイトルはログに出さない)
#
# 新規の判定は検索条件の firstSeen で行う。レスポンスの firstSeen は「問い合わせた期間の中で最初に起きた日時」
# で、本当の初回とは限らないため使わない (2026-10-04 実測)。environment を付けた検索の firstSeen は
# 環境ごとの初回 (GroupEnvironment.first_seen) なので、本番の新規は「本番で初めて起きた issue」になる。
# API が 200 以外を返したら exit 1 (workflow は state を保存しない)。
set -euo pipefail

: "${SENTRY_API_TOKEN:?SENTRY_API_TOKEN is not set}"
: "${SENTRY_ORG:?SENTRY_ORG is not set}"
WINDOW_HOURS="${WINDOW_HOURS:-24}"
if [[ ! "${WINDOW_HOURS}" =~ ^[0-9]+$ ]] || (( WINDOW_HOURS < 1 || WINDOW_HOURS > 720 )); then
  echo "::error title=Invalid window::WINDOW_HOURS must be an integer from 1 to 720"
  exit 1
fi
LIMIT=100
# 使わない集計 (時系列・全期間と絞り込み後の発生数・unhandled の判定) を省く。count は残る
# (collapse=stats は count まで消えるので付けない)
EXTRA='&groupStatsPeriod=&collapse=lifetime&collapse=filtered&collapse=unhandled'

start="$(jq -rn --argjson h "${WINDOW_HOURS}" '(now - $h * 3600) | floor | strftime("%Y-%m-%dT%H:%M:%SZ")')"

truncated=false
fetch() {  # $1 = 書き出すファイル、$2 = 検索条件、$3 = 追加のクエリパラメータ
  local query code
  query="$(jq -rn --arg q "$2" '$q | @uri')"
  code="$(curl -sS --max-time 20 -o raw.json -w '%{http_code}' \
    -H @<(printf 'Authorization: Bearer %s\n' "${SENTRY_API_TOKEN}") \
    "https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?limit=${LIMIT}&sort=new&query=${query}${3:-}${EXTRA}")" \
    || code=000
  if [[ "${code}" != "200" ]] || ! jq -e 'type == "array"' raw.json > /dev/null 2>&1; then
    echo "::error title=Sentry API failed::HTTP ${code} while fetching $1"
    exit 1
  fi
  # 次のページは読まない。上限に達したら文面とログで知らせる (新しい順なので、漏れるのは古い側)
  if [[ "$(jq length raw.json)" -ge "${LIMIT}" ]]; then
    truncated=true
    echo "::warning title=Sentry digest truncated::$1 reached the limit of ${LIMIT}. Older issues were not checked."
  fi
  jq '[.[] | {id: (.id | tostring), shortId, title, level, priority, count, project: .project.slug}]' raw.json > "$1"
  rm -f raw.json
}

fetch prod-new.json "firstSeen:>${start}" '&environment=production'
fetch prod-regressed.json 'is:regressed' '&environment=production'
fetch other-new.json "!environment:production firstSeen:>${start}"
fetch other-regressed.json '!environment:production is:regressed'

# 件数だけをログに残す (タイトルは public なログに出さない)
echo "Since ${start} (truncated: ${truncated}):" \
  "production new $(jq length prod-new.json) / regressed $(jq length prod-regressed.json)," \
  "other new $(jq length other-new.json) / regressed $(jq length other-regressed.json)"
{
  echo "window_start=${start}"
  echo "truncated=${truncated}"
} >> "${GITHUB_OUTPUT}"
