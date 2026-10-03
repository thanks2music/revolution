#!/usr/bin/env bash
# chat.postMessage の payload (JSON) を標準出力へ書く。ネットワークには出ない。
#
# 入力 (env):
#   PAYLOAD_CHANNEL      投稿先チャンネル ID (必須)
#   PAYLOAD_TEXT         1 行の要約 (必須)。& < > をエスケープする
#   PAYLOAD_PREFIX       要約の先頭に付ける文字列 (テストモードの "[TEST] ")
#   PAYLOAD_MENTION      メンションするユーザー ID (空ならメンションしない)
#   PAYLOAD_BODY         補足の mrkdwn (呼び出し側の責任でエスケープ済みの前提)
#   PAYLOAD_BLOCKS_FILE  追加する blocks (JSON 配列) のファイル。不正なら無視して warning
#   PAYLOAD_RUN_URL      context に載せる workflow run の URL
#
# レイアウト:
#   block 0 = section(メンション + 要約)  ← header は plain_text でメンションできないため使わない
#   block 1 = section(補足)               ← 補足がある時だけ
#   以降    = 呼び出し側の blocks
#   最後    = context(workflow run へのリンク)
# top-level の text は block 0 と同じ文字列 (blocks 使用時に通知へ表示されるのは text のため)。
set -euo pipefail

# 追加 blocks はファイルのまま --slurpfile で渡す (引数で渡すと Linux の 1 引数 128KB 上限に当たる)。
# 無い時は /dev/null を渡す (--slurpfile は空の配列になり、$extra[0] は null)
extra_file=/dev/null
if [[ -n "${PAYLOAD_BLOCKS_FILE:-}" ]]; then
  if jq -e 'type == "array"' "${PAYLOAD_BLOCKS_FILE}" >/dev/null 2>&1; then
    extra_file="${PAYLOAD_BLOCKS_FILE}"
  else
    echo "::warning title=Slack notify::blocks-file is not a JSON array. Ignoring it." >&2
  fi
fi

jq -n \
  --arg channel "${PAYLOAD_CHANNEL}" \
  --arg text "${PAYLOAD_TEXT}" \
  --arg prefix "${PAYLOAD_PREFIX:-}" \
  --arg mention "${PAYLOAD_MENTION:-}" \
  --arg body "${PAYLOAD_BODY:-}" \
  --arg run_url "${PAYLOAD_RUN_URL:-}" \
  --slurpfile extra "${extra_file}" '
  def esc: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
  # 切った位置が &amp; などの途中だと表示が崩れるので、末尾の欠けた entity を落とす。
  # body は生の mrkdwn なので、閉じていないリンク記法 (<url|text の途中) も落とす
  def trunc($n): if length > $n then (.[0:($n - 1)] | sub("&[a-z]{0,4}$"; "") | sub("<[^>]*$"; "")) + "…" else . end;

  ((if $mention != "" then "<@" + ($mention | esc) + "> " else "" end)
    + ($prefix | esc) + ($text | esc) | trunc(2900)) as $summary
  | {
      channel: $channel,
      text: $summary,
      unfurl_links: false,
      unfurl_media: false,
      # Block Kit の上限は 50 blocks。末尾の実行ログへのリンクが落ちないよう、先に 49 個へ切る
      blocks: (
        (
          [{ type: "section", text: { type: "mrkdwn", text: $summary } }]
          + (if $body != "" then [{ type: "section", text: { type: "mrkdwn", text: ($body | trunc(3000)) } }] else [] end)
          + ($extra[0] // [])
          | .[0:49]
        )
        + (if $run_url != "" then [{ type: "context", elements: [{ type: "mrkdwn", text: ("<" + $run_url + "|実行ログ (GitHub Actions)>") }] }] else [] end)
      )
    }'
