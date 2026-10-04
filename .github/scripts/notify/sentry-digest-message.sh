#!/usr/bin/env bash
# fetch-issues.sh が取得した Sentry の issue から、Slack 通知の内容を組み立てる
# (.github/workflows/sentry-digest.yml から呼ばれる)。ネットワークには出ない。
#
# 入力 (env):
#   PROD_NEW / PROD_REGRESSED / OTHER_NEW / OTHER_REGRESSED  fetch-issues.sh が書いた JSON ファイル
#   NOTIFIED_FILE     前回までの「知らせ済み」(キー → 知らせた日時) の JSON。無い・壊れている時は空として扱い、
#                     重複することがある旨を文面に書く
#   WINDOW_START / TRUNCATED  fetch-issues.sh の出力
#   SENTRY_WEB        https://<org>.sentry.io (issue へのリンクに使う)
#
# 出力:
#   $GITHUB_OUTPUT  prod_notify / prod_text、dev_notify / dev_text、all_notify / all_text (テストモードで 1 通にまとめる時)
#   ファイル        prod-blocks.json / dev-blocks.json / all-blocks.json (issue の一覧。blocks-file で渡す)、
#                   notified-base.json (前回までの記録から、もう要らないものを除いたもの)、
#                   prod-delivered.json / dev-delivered.json (その送り先に届いたら記録に足すもの)
#
# 振り分け: 本番 (environment=production) の priority High は本番系 (メンション付き)、それ以外 (本番の Medium /
# Low と、本番以外の環境) は開発系 (メンションなし)。priority が無い時は level で判断する。docs/sentry.md の
# 「通知との対応」(High だけをメール通知する) と同じ線引き。
#
# 「知らせ済み」のキーは <new|reg>:<prod|dev>:<issue id>。送り先ごとに分けるのは、開発系で知らせた issue が
# 後で本番の High になった時に本番系へ届けるため。
#   - new: 毎回直近の期間を見直すので、知らせた issue を除く。期間の始まりより前に記録したものは捨てる
#     (その issue の firstSeen は記録した時刻より前なので、もう検索に当たらない)
#   - reg: 回帰中のあいだ検索に当たり続けるので、一度知らせたら回帰が終わるまで知らせない。
#     いま回帰中でない issue の記録は捨てる (解決して再び回帰したら、また知らせる)。取得が上限に達した時は捨てない
#
# issue のタイトルは blocks のファイルにだけ書く。composite action の text / body に入れると、
# 入力として public なログに出るため。
set -euo pipefail

state_missing=false
notified="${NOTIFIED_FILE:-}"
if ! jq -e 'type == "object"' "${notified}" > /dev/null 2>&1; then
  state_missing=true
  notified="$(mktemp)"
  echo '{}' > "${notified}"
fi

jq -n -r \
  --slurpfile prod_new "${PROD_NEW}" \
  --slurpfile prod_reg "${PROD_REGRESSED}" \
  --slurpfile other_new "${OTHER_NEW}" \
  --slurpfile other_reg "${OTHER_REGRESSED}" \
  --slurpfile notified "${notified}" \
  --arg start "${WINDOW_START}" \
  --arg missing "${state_missing}" \
  --arg truncated "${TRUNCATED:-false}" \
  --arg web "${SENTRY_WEB}" '
  def oneline: tostring | gsub("[\r\n]+"; " ");
  def esc: oneline | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
  # エスケープ後に切るので、末尾の欠けた entity (&am など) を落とす
  def trunc($n): if length > $n then (.[0:($n - 1)] | sub("&[a-z]{0,4}$"; "")) + "…" else . end;
  # section の上限 (3000 字) に収まる行だけを先頭から採る (行の途中では切らない。入らない分は「ほか N 件」へ)
  def fit($budget): [foreach .[] as $l (0; . + ($l | length) + 1; select(. <= $budget) | $l)];
  # 並び (新しい順) を保ったまま id で重複を除く
  def uniq: reduce .[] as $i ([]; if any(.[]; .id == $i.id) then . else . + [$i] end);
  def high: if .priority != null then .priority == "high" else (.level | IN("error", "fatal")) end;
  # リンクは手元の値から組み立てる (API の応答の URL は使わない)
  def link: (.shortId // "?" | esc | trunc(40)) as $label
    | if (.id // "" | tostring | test("^[0-9]+$")) then "<\($web)/issues/\(.id)/|\($label)>" else $label end;
  def line:
    "• " + (if .env == "production" then "[本番] " else "" end) + link + " " + (.title // "" | esc | trunc(120))
    + " — " + ([.project, .level] | map(select(. != null) | esc | trunc(60)) | join(" · "))
    + " · \(.count // "?" | esc | trunc(12)) 回";
  def section($label; $items):
    if ($items | length) == 0 then []
    else ($items[0:10] | map(line) | fit(2700)) as $shown
      | (($items | length) - ($shown | length)) as $rest
      | [{type: "section", text: {type: "mrkdwn", text: (
          "*\($label)* \($items | length) 件\n" + ($shown | join("\n"))
          + (if $rest > 0 then "\n…ほか \($rest) 件 (<\($web)/issues/|Sentry で一覧を見る>)" else "" end))}}] end;
  def counts($new; $reg):
    [(if ($new | length) > 0 then "新規 \($new | length) 件" else empty end),
     (if ($reg | length) > 0 then "再発 \($reg | length) 件" else empty end)] | join(" · ");
  def marks($kind; $key; $items):
    (now | strftime("%Y-%m-%dT%H:%M:%SZ")) as $at
    | $items | map({key: "\($kind):\($key):\(.id)", value: $at}) | from_entries;

  ([$prod_reg[0][], $other_reg[0][]] | map(.id)) as $regressed_now
  | ($notified[0] | with_entries(select(
      if (.key | startswith("new:")) then (.value | tostring) >= $start
      # 取得が上限に達した時は、回帰中なのに一覧から漏れた issue があり得るので消さない
      elif (.key | startswith("reg:")) then $truncated == "true" or (.key | split(":")[2] | IN($regressed_now[]))
      else false end))) as $seen
  | ([$prod_new[0][], $prod_reg[0][]] | map(select(high) | .id)) as $high_ids
  | def unseen($kind; $key): map(select("\($kind):\($key):\(.id)" as $k | $seen | has($k) | not));
  # 本番の High は本番系にだけ載せる。本番の Medium / Low には印を付けて開発系へ
  def prod_list($items; $kind): $items | map(select(high)) | unseen($kind; "prod");
  def dev_list($prod; $other; $kind):
    [$prod[] | select(high | not) | . + {env: "production"}] + $other
    | uniq | map(select(.id | IN($high_ids[]) | not)) | unseen($kind; "dev");
  def target($key; $label; $new; $reg; $context):
    (section("🆕 新規"; $new) + section("🔁 再発"; $reg)) as $sections
    | {notify: (($new + $reg | length) > 0), count: ($new + $reg | length), label: $label,
       text: "🐞 Sentry (\($label)): \(counts($new; $reg))",
       sections: $sections, blocks: ($sections + $context),
       delivered: (marks("new"; $key; $new) + marks("reg"; $key; $reg))};

  [{type: "context", elements: [{type: "mrkdwn", text: (
      "対象: \($start) 以降 (UTC) に初めて起きた issue と、いま回帰中の issue"
      + (if $missing == "true" then "\n⚠️ 前回の状態が見つからないため、前に届いたものと重複することがある" else "" end)
      + (if $truncated == "true" then "\n⚠️ 1 回の取得の上限に達したため、一部しか確かめていない。<\($web)/issues/|Sentry> で確認すること" else "" end)
    )}]}] as $context
  | {prod: target("prod"; "本番"; prod_list($prod_new[0]; "new"); prod_list($prod_reg[0]; "reg"); $context),
     dev: target("dev"; "本番以外・優先度の低いもの";
                 dev_list($prod_new[0]; $other_new[0]; "new"); dev_list($prod_reg[0]; $other_reg[0]; "reg"); $context),
     base: $seen}
  # テストモードでは開発系へ 1 通にまとめる (同じ送り先に 1 実行で 2 通送らない)
  | .all = {notify: (.prod.notify or .dev.notify),
            text: "🐞 Sentry: \(.prod.label) \(.prod.count) 件 · \(.dev.label) \(.dev.count) 件",
            blocks: (([.prod, .dev] | map(select(.notify) | [{type: "section", text: {type: "mrkdwn", text: "*\(.label)*"}}] + .sections)
                      | if length == 2 then .[0] + [{type: "divider"}] + .[1] else add // [] end) + $context)}
' > digest.json

for target in prod dev all; do
  jq ".${target}.blocks" digest.json > "${target}-blocks.json"
done
for target in prod dev; do
  jq ".${target}.delivered" digest.json > "${target}-delivered.json"
done
jq '.base' digest.json > notified-base.json
jq -r '["prod", "dev", "all"][] as $t | "\($t)_notify=\(.[$t].notify)", "\($t)_text=\(.[$t].text)"' digest.json >> "${GITHUB_OUTPUT}"
rm -f digest.json
