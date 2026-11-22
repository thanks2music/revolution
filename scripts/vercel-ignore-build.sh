#!/bin/bash
# Vercel の deploy の判定 (方針と理由は docs/build.md の「Vercel の Preview と、ビルドする条件」)
#
# Usage:
#   bash ../../scripts/vercel-ignore-build.sh docs                       # docs の Ignored Build Step (apps/docs/vercel.json)
#   bash scripts/vercel-ignore-build.sh --changed <frontend|docs> <from> <to> # 入力が変わったか (.github/workflows/vercel-preview.yml)
#   bash scripts/vercel-ignore-build.sh --paths <frontend|docs>            # 入力の一覧を 1 行ずつ出す
#
# Ignored Build Step としては: Preview は常にビルドする (Actions が要る時だけ作っている)。Production は、
# docs の入力が前回の成功デプロイ (VERCEL_GIT_PREVIOUS_SHA) から変わった時だけビルドする。判定できない時は
# 必ずビルドする。終了コード (Vercel の規約): 0 = ビルドしない / 1 = ビルドする
#   https://vercel.com/docs/project-configuration/vercel-json#ignorecommand
# --changed の終了コード: 0 = 変わっていない / 1 = 変わった (変わったファイルの先頭 20 件を出す) / 2 = 誤り
# 読む環境変数: VERCEL_ENV / VERCEL_GIT_PREVIOUS_SHA / VERCEL_GIT_REPO_OWNER / VERCEL_GIT_REPO_SLUG
# frontend は Ignored Build Step を使わない (本番は毎回ビルドする。templates の取り込みのため)

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

# アプリのビルド結果を変えうるパス (リポジトリのルートからの git の pathspec。ディレクトリならその配下すべてに当たる)。
# 足すのは自由。消すのは、そのアプリの build も実行時も読まないと確かめてから。
# lockfile はファイル単位なので、そのアプリに関係ない依存の更新でもビルドする
COMMON_PATHS=(
  shared                         # @revolution/schemas など
  package.json                   # ルートの package.json だけに当たる
  pnpm-lock.yaml
  pnpm-workspace.yaml
  .npmrc                         # 今は無い。足されたら install が変わる
  .pnpmfile.cjs
  patches
  turbo.json
)
FRONTEND_PATHS=(
  apps/frontend                  # アプリ本体 (vercel.json を含む)
  apps/ai-writer/content         # 記事の MDX (lib/mdx/articles.ts が build 時と実行時に読む。build の前に作る索引の元)
  apps/ai-writer/scripts/generate-article-index.ts # build の前に索引を作るスクリプトと、その import 先
  apps/ai-writer/lib/mdx/parse-frontmatter.ts
  apps/ai-writer/lib/utils/date.ts
  "${COMMON_PATHS[@]}"
)
DOCS_PATHS=(
  apps/docs                      # アプリ本体 (vercel.json を含む)
  ':(glob)docs/*.md'             # repo 直下の docs/ の直下だけ (apps/docs/lib/source.ts が読む。archive/ などは読まない)
  docs/meta.json
  scripts/vercel-ignore-build.sh # docs の本番の判定そのもの
  "${COMMON_PATHS[@]}"
)

build() { decided=1; echo "[ignore-build] build: $*"; exit 1; }
skip() { decided=1; echo "[ignore-build] skip: $*"; exit 0; }

paths_of() {
  case "${1:-}" in
    frontend) printf '%s\n' "${FRONTEND_PATHS[@]}" ;;
    docs) printf '%s\n' "${DOCS_PATHS[@]}" ;;
    *) return 1 ;;
  esac
}

if [ "${1:-}" = "--paths" ]; then
  decided=1
  paths_of "${2:-}" || { echo "usage: $0 --paths <frontend|docs>" >&2; exit 2; }
  exit 0
fi

if [ "${1:-}" = "--changed" ]; then
  decided=1
  # 引数が足りない時も 2 (1 は「変わった」と読まれ、作る側に倒れてしまう)
  [ -n "${3:-}" ] && [ -n "${4:-}" ] || { echo "usage: $0 --changed <frontend|docs> <from> <to>" >&2; exit 2; }
  list=$(paths_of "${2:-}") || { echo "usage: $0 --changed <frontend|docs> <from> <to>" >&2; exit 2; }
  mapfile -t paths <<< "$list"
  # --no-renames: rename の判定はファイルの中身を読むので、blob を取らない clone では取りに行ってしまう
  changed=$(git diff --no-renames --name-only "$3" "$4" -- "${paths[@]}") || exit 2
  [ -n "$changed" ] || exit 0
  head -n 20 <<< "$changed"
  exit 1
fi

app="${1:-}"
[ "$app" = docs ] || build "アプリの指定が docs ではない (${app:-未指定})"
MUST_BUILD_PATHS=("${DOCS_PATHS[@]}")

# ビルドしない判定に進むのは Production だけ。Preview は Actions が要る時だけ作っている。
# VERCEL_ENV が無い時 (システム環境変数を公開する設定が外れた時など) もビルドする
case "${VERCEL_ENV:-}" in
  production) ;;
  preview) build "Preview は GitHub Actions が要る時だけ作っている" ;;
  *) build "Production ではない (VERCEL_ENV=${VERCEL_ENV:-未設定})" ;;
esac

head_sha=$(git rev-parse --verify --quiet 'HEAD^{commit}') || build "git の作業ツリーではない (HEAD を読めない)"
base=${VERCEL_GIT_PREVIOUS_SHA:-}
[ -n "$base" ] || build "前回の成功デプロイが分からない (このアプリの初めての本番)"
# git の引数に渡すので、commit の SHA (40 桁の 16 進数) でなければビルドする
if ! [[ "$base" =~ ^[0-9a-f]{40}$ ]]; then
  build "VERCEL_GIT_PREVIOUS_SHA が commit の SHA ではない"
fi
[ "$base" != "$head_sha" ] || build "前回と同じ commit (手動の Redeploy)"

# Vercel の clone は浅い (depth 10)。比べる commit が無ければ public の GitHub から取る。
# 比べるのは 2 つの commit の木だけなので、depth 1 で、ファイルの中身 (blob) は取らない。
# 取得は使い捨ての bare repo に行う。ビルドが使う checkout に取得すると、その浅い履歴が短くなり、
# 履歴を読む処理 (Sentry の release と commit の紐付けなど) が変わりうるため。
# 取得を終えてから、使い捨ての repo に checkout の object を alternates でつなぎ、比較はそこで行う。
# 取得の前につながない: 浅い checkout を alternates に持つと、fetch が「親の commit も持っている」と
# 伝えてしまい、必要な object が送られず失敗する
remote="https://github.com/${VERCEL_GIT_REPO_OWNER:-}/${VERCEL_GIT_REPO_SLUG:-}.git"
scratch=$(mktemp -d)
git init -q --bare "$scratch"
sgit() { git --git-dir="$scratch" "$@"; }
fetch_commit() {
  # 認証を求められても待たず、GitHub の応答が止まったら 20 秒で打ち切る (どちらもビルドする側に倒れる)
  GIT_TERMINAL_PROMPT=0 sgit -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 \
    fetch --quiet --no-tags --depth=1 --filter=blob:none "$remote" "$1" 2>/dev/null
}

against="前回の成功デプロイ (${base:0:12})"
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  fetch_commit "$base" || build "$against を取得できない"
  sgit cat-file -e "$base^{commit}" 2>/dev/null || build "$against が無い"
fi
git rev-parse --path-format=absolute --git-path objects > "$scratch/objects/info/alternates"

# --no-renames: rename の判定はファイルの中身を読むため、取っていない blob を取りに行ってしまう
changed=$(sgit diff --no-renames --name-only "$base" "$head_sha" -- "${MUST_BUILD_PATHS[@]}") \
  || build "git diff が失敗した"
[ -n "$changed" ] || skip "$app の入力は $against から変わっていない"
echo "[ignore-build] 変わったファイル (先頭 20 件):"
head -n 20 <<< "$changed"
build "$app の入力が $against から変わった"
