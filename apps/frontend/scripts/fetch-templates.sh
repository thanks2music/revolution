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
# どちらも無い・取れない時:
#   - 本番 (VERCEL_ENV=production) はビルドを止める (審査が全件「失敗」になるのに気づけないため)
#   - それ以外は警告だけ出して続ける (口コミは BOSS の確認待ちに回り、公開されない側に倒れる)
#
# token は表示しない (set -x を使わない。curl のエラーにも出さない)。
set -euo pipefail

cd "$(dirname "$0")/.."

DEST=templates
REPO="${TEMPLATES_REPO:-thanks2music/revolution-templates}"
REF="${TEMPLATES_REF:-main}"
# 取り込むファイル (templates repo の中のパス)
FILES=(reviews/screening.yaml)

fail_or_warn() {
  if [ "${VERCEL_ENV:-}" = "production" ]; then
    echo "[fetch-templates] error: $1" >&2
    exit 1
  fi
  echo "[fetch-templates] warning: $1 (審査は失敗として扱われ、口コミは公開されません)" >&2
  exit 0
}

rm -rf "${DEST:?}/reviews"

if [ -n "${TEMPLATES_SOURCE_PATH:-}" ]; then
  [ -d "$TEMPLATES_SOURCE_PATH" ] || fail_or_warn "TEMPLATES_SOURCE_PATH が見つかりません"
  for file in "${FILES[@]}"; do
    [ -f "$TEMPLATES_SOURCE_PATH/$file" ] || fail_or_warn "$file が templates repo にありません"
    mkdir -p "$DEST/$(dirname "$file")"
    cp "$TEMPLATES_SOURCE_PATH/$file" "$DEST/$file"
  done
  echo "[fetch-templates] copied ${#FILES[@]} file(s) from TEMPLATES_SOURCE_PATH"
  exit 0
fi

if [ -n "${TEMPLATES_READ_TOKEN:-}" ]; then
  for file in "${FILES[@]}"; do
    mkdir -p "$DEST/$(dirname "$file")"
    if ! curl -fsS --retry 2 \
      -H "Authorization: Bearer ${TEMPLATES_READ_TOKEN}" \
      -H "Accept: application/vnd.github.raw+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -o "$DEST/$file" \
      "https://api.github.com/repos/${REPO}/contents/${file}?ref=${REF}" 2>/dev/null; then
      rm -f "$DEST/$file"
      fail_or_warn "$file を GitHub から取れませんでした"
    fi
  done
  echo "[fetch-templates] fetched ${#FILES[@]} file(s) from ${REPO}@${REF}"
  exit 0
fi

fail_or_warn "TEMPLATES_SOURCE_PATH も TEMPLATES_READ_TOKEN もありません"
