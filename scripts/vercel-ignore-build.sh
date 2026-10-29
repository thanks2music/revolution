#!/bin/bash
# Vercel の Ignored Build Step (revolution-phoenix-frontend 専用)
#
# Preview は、frontend のビルド結果を変えうるファイルが「比べる commit」から変わっていなければ
# ビルドしない (Vercel 上は CANCELED になる)。比べる commit は、この branch で最後に成功した
# デプロイ (VERCEL_GIT_PREVIOUS_SHA)。branch の初回デプロイでは main の先頭と比べる。
# Production は常にビルドする。判定できない時は必ずビルドする
# (ビルドしないのは「変わっていない」と確かめられた時だけ)。
#
# Usage (apps/frontend/vercel.json の ignoreCommand。Vercel は Root Directory = apps/frontend で実行する):
#   bash ../../scripts/vercel-ignore-build.sh
#
# 終了コード (Vercel の規約): 0 = ビルドしない / 1 = ビルドする
#   https://vercel.com/docs/project-configuration/vercel-json#ignorecommand
# 読む環境変数: VERCEL_ENV / VERCEL_GIT_PREVIOUS_SHA / VERCEL_GIT_REPO_OWNER / VERCEL_GIT_REPO_SLUG
# テスト用: VERCEL_IGNORE_BUILD_REMOTE (浅い clone に無い commit の取得先を差し替える)

set -euo pipefail

decided=
scratch=
# build / skip を通らずに終わったら (想定外のエラー) ビルドする。終了コードが 1 でも理由を出す
# trap から呼ぶ関数を「呼ばれていない」と判定させない (ShellCheck の版で番号が違うので両方書く)
# shellcheck disable=SC2317,SC2329
on_exit() {
  local rc=$?
  if [ -n "$scratch" ]; then rm -rf "$scratch"; fi
  if [ -z "$decided" ]; then
    echo "[ignore-build] build: 想定外のエラー (exit $rc)"
    exit 1
  fi
}
trap on_exit EXIT

# frontend のビルド結果を変えうるパス (リポジトリのルートからの pathspec。ディレクトリならその配下すべてに当たる)。
# 足すのは自由。消すのは、frontend の build も実行時も読まないと確かめてから
MUST_BUILD_PATHS=(
  apps/frontend                  # アプリ本体 (vercel.json と lib/mdx/article-index.json を含む)
  apps/ai-writer/content         # 記事の MDX (lib/mdx/articles.ts が build 時と実行時に読む)
  shared                         # @revolution/schemas (next.config.mjs の transpilePackages)
  package.json                   # ルートの package.json だけに当たる
  pnpm-lock.yaml
  pnpm-workspace.yaml
  .npmrc                         # 今は無い。足されたら install が変わる
  .pnpmfile.cjs
  patches
  turbo.json
  scripts/vercel-ignore-build.sh # この判定そのもの
)
BASE_BRANCH=main

build() { decided=1; echo "[ignore-build] build: $*"; exit 1; }
skip() { decided=1; echo "[ignore-build] skip: $*"; exit 0; }

# ビルドしない判定に進むのは Preview だけ。VERCEL_ENV が無い時 (システム環境変数を公開する設定が
# 外れた時など) もビルドする
case "${VERCEL_ENV:-}" in
  preview) ;;
  production) build "Production は常にビルドする" ;;
  *) build "Preview ではない (VERCEL_ENV=${VERCEL_ENV:-未設定})" ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || build "git の作業ツリーではない"
cd "$root"
head_sha=$(git rev-parse --verify --quiet 'HEAD^{commit}') || build "HEAD を読めない"

remote=${VERCEL_IGNORE_BUILD_REMOTE:-"https://github.com/${VERCEL_GIT_REPO_OWNER:-}/${VERCEL_GIT_REPO_SLUG:-}.git"}

# Vercel の clone は浅い (depth 10)。比べる commit が無ければ public の GitHub から取る。
# 2 つの commit の木を比べるだけなので depth 1 で足りる。
# 取得は使い捨ての bare repo に行う。ビルドが使う checkout に取得すると、その浅い履歴が短くなり、
# 履歴を読む処理 (Sentry の release と commit の紐付けなど) が変わりうるため。
# 取得を終えてから、使い捨ての repo に checkout の object を alternates でつなぎ、比較はそこで行う。
# 取得の前につながない: 浅い checkout を alternates に持つと、fetch が「親の commit も持っている」と
# 伝えてしまい、必要な object が送られず失敗する
scratch=$(mktemp -d)
git init -q --bare "$scratch"
sgit() { git --git-dir="$scratch" "$@"; }
fetch_commit() {
  # 認証を求められても待たず、GitHub の応答が止まったら 20 秒で打ち切る (どちらもビルドする側に倒れる)
  GIT_TERMINAL_PROMPT=0 sgit -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 \
    fetch --quiet --no-tags --depth=1 "$remote" "$1" 2>/dev/null
}

base=${VERCEL_GIT_PREVIOUS_SHA:-}
if [ -z "$base" ]; then
  fetch_commit "refs/heads/$BASE_BRANCH" || build "branch の初回デプロイで $BASE_BRANCH を取得できない"
  base=$(sgit rev-parse --verify --quiet 'FETCH_HEAD^{commit}') || build "$BASE_BRANCH の commit を読めない"
  against="$BASE_BRANCH の先頭 (${base:0:12})"
else
  if [ "$base" = "$head_sha" ]; then
    build "前回と同じ commit (手動の Redeploy)"
  fi
  if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    fetch_commit "$base" || build "前回の成功デプロイの commit (${base:0:12}) を取得できない"
    sgit cat-file -e "$base^{commit}" 2>/dev/null || build "前回の成功デプロイの commit (${base:0:12}) が無い"
  fi
  against="前回の成功デプロイ (${base:0:12})"
fi
git rev-parse --path-format=absolute --git-common-dir | sed 's|$|/objects|' > "$scratch/objects/info/alternates"

set +e
sgit diff --quiet "$base" "$head_sha" -- "${MUST_BUILD_PATHS[@]}"
rc=$?
set -e
case $rc in
  0) skip "frontend の入力は $against から変わっていない" ;;
  1)
    echo "[ignore-build] 変わったファイル (先頭 20 件):"
    sgit diff --name-only "$base" "$head_sha" -- "${MUST_BUILD_PATHS[@]}" | head -n 20 || true
    build "frontend の入力が $against から変わった"
    ;;
  *) build "git diff が失敗した (exit $rc)" ;;
esac
