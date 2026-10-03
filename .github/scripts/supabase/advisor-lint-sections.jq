# Supabase Advisor の lint 配列を Slack Block Kit の section 配列に変換する。
#
# 使い方:
#   jq --arg label "🆕 新規" --argjson max 5 --argjson remediation true \
#     -f .github/scripts/supabase/advisor-lint-sections.jq new-lints.json
#
# 入力: [{ name, level, detail, remediation }, ...]
# 引数:
#   $label        見出しの接頭辞 (例: "🆕 新規" / "✅ 解消")
#   $max          表示する最大件数 (超過分は呼び出し側で「…ほか N 件」を出す)
#   $remediation  true なら対処方法 (remediation) へのリンクを付ける
#
# Supabase API 由来の値はすべて & < > をエスケープする (`<!channel>` 混入対策)。
# section の text は 3000 字が上限なので detail を切り詰める。

def esc: tostring | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
def trunc($n): if length > $n then (.[0:($n - 1)] | sub("&[a-z]{0,4}$"; "")) + "…" else . end;
# リンク記法 <url|text> に入れる URL。`|` は区切りとして解釈されるため %7C にし、
# http(s) でない値や極端に長い値は使わずに Advisor の一般的な案内ページへ差し替える
# (section の上限 3000 字を超えると、Slack がメッセージごと invalid_blocks で拒否するため)
def link_url:
  if (type == "string") and test("^https?://") and (length <= 500)
  then gsub("\\|"; "%7C") | esc
  else "https://supabase.com/docs/guides/database/database-linter" end;

[
  .[0:$max][]
  | {
      type: "section",
      text: {
        type: "mrkdwn",
        text: (
          "*" + $label + ": `" + ((.name // "unknown") | esc | trunc(200)) + "` (" + ((.level // "?") | esc | trunc(20)) + ")*\n"
          + ((.detail // "(詳細なし)") | esc | trunc(2000))
          + (if $remediation
             then "\n<" + (.remediation | link_url) + "|対処方法>"
             else "" end)
        )
      }
    }
]
