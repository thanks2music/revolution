#!/usr/bin/env bash
# 公開サイトが使うプロンプトを、private の templates repo から apps/frontend/templates/ に取り込む。
#
# プロンプトの文面は templates repo が正本 (SoC: プロンプトは YAML に置き、public の repo に書かない)。
# `pnpm build` の最初に走る。取り込んだ物は gitignore 済みで、`next.config.mjs` の
# `outputFileTracingIncludes` でサーバーの関数に含める。
#
# 取り込み元 (先に当てはまった方):
#   1. TEMPLATES_SOURCE_PATH: 手元の templates repo の作業ツリー (手元のビルド)
#   2. TEMPLATES_READ_TOKEN: GitHub の API で取る (Vercel。contents を読むだけの fine-grained token)
#
# 取り込んだ後に、プロンプトの形を読み込みの関数 (lib/reviews/screener/prompt.ts) で確かめる。
# 取り込みに成功して形も正しい時だけ、前の物と入れ替える (失敗した時に、手元の取り込み済みの物を消さない)。
#
# 取り込み元が無い・取れない・形が崩れている時:
#   - 本番 (VERCEL_ENV=production) はビルドを止める (審査が全件「失敗」になるのに気づけないため)
#   - それ以外は警告だけ出して続ける (口コミは BOSS の確認待ちに回り、公開されない側に倒れる)
#
# token は表示しない (set -x を使わない。curl のエラーには URL しか出ない)。
set -euo pipefail

cd "$(dirname "$0")/.."

# 置き先 (テストでだけ変える)
DEST="${TEMPLATES_DEST:-templates}"
REPO="${TEMPLATES_REPO:-thanks2music/revolution-templates}"
REF="${TEMPLATES_REF:-main}"
# 取り込むファイル (templates repo の中のパス)
FILES=(reviews/screening.yaml)

STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

fail_or_warn() {
  if [ "${VERCEL_ENV:-}" = "production" ]; then
    echo "[fetch-templates] error: $1" >&2
    exit 1
  fi
  echo "[fetch-templates] warning: $1 (審査は失敗として扱われ、口コミは公開されません)" >&2
  exit 0
}

if [ -n "${TEMPLATES_SOURCE_PATH:-}" ]; then
  [ -d "$TEMPLATES_SOURCE_PATH" ] || fail_or_warn "TEMPLATES_SOURCE_PATH が見つかりません"
  for file in "${FILES[@]}"; do
    [ -f "$TEMPLATES_SOURCE_PATH/$file" ] || fail_or_warn "$file が templates repo にありません"
    mkdir -p "$STAGING/$(dirname "$file")"
    cp "$TEMPLATES_SOURCE_PATH/$file" "$STAGING/$file"
  done
  source_label="TEMPLATES_SOURCE_PATH"
elif [ -n "${TEMPLATES_READ_TOKEN:-}" ]; then
  for file in "${FILES[@]}"; do
    mkdir -p "$STAGING/$(dirname "$file")"
    status=$(curl -sS --retry 2 --max-time 30 -o "$STAGING/$file" -w '%{http_code}' \
      -H "Authorization: Bearer ${TEMPLATES_READ_TOKEN}" \
      -H "Accept: application/vnd.github.raw+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/${REPO}/contents/${file}?ref=${REF}") || status="curl-error"
    [ "$status" = "200" ] || fail_or_warn "$file を GitHub から取れませんでした (HTTP ${status})"
  done
  source_label="${REPO}@${REF}"
else
  fail_or_warn "TEMPLATES_SOURCE_PATH も TEMPLATES_READ_TOKEN もありません"
fi

# 形を確かめる (読み込みの関数と同じスキーマ)。崩れていれば入れ替えない
if ! node_modules/.bin/tsx scripts/check-review-prompt.ts "$STAGING" >&2; then
  fail_or_warn "取り込んだプロンプトの形が正しくありません"
fi

for file in "${FILES[@]}"; do
  mkdir -p "$DEST/$(dirname "$file")"
  cp "$STAGING/$file" "$DEST/$file"
done
echo "[fetch-templates] ${#FILES[@]} file(s) from ${source_label}"
