---
title: ビルド & 開発コマンド
---

Revolution は pnpm workspaces + Turborepo を採用しており、ルートから `pnpm <command>` で workspace 全体を統括できます。

## 主要コマンド

| コマンド | 説明 |
|---|---|
| `pnpm dev` | Frontend と AI Writer を並列起動 |
| `pnpm dev:frontend` | Frontend のみ起動 |
| `pnpm dev:ai-writer` | AI Writer のみ起動 |
| `pnpm dev:docs` | ドキュメントサイト (`apps/docs`) のみ起動 (http://localhost:3333) |
| `pnpm build` | Frontend と AI Writer を並列ビルド |
| `pnpm build:docs` | ドキュメントサイトをビルド (`docs/` 直下の frontmatter の抜けもここで落ちる) |
| `pnpm lint` | ESLint 全 workspace |
| `pnpm type-check` | TypeScript 型チェック (strict mode) |
| `pnpm test` | Jest テスト全 workspace (Layer 1/2、E2E は別) |
| `pnpm --filter @revolution/ai-writer test:e2e` | Layer 3 E2E (Vision API 実 key 必要、AI Writer 配下のみ、PR #217 で分離) |

## 個別 workspace へのコマンド送出

```bash
# AI Writer のみ test
pnpm --filter @revolution/ai-writer test

# Frontend のみ build
pnpm --filter frontend-nextjs-headless-cms build

# AI Writer の Vision API 動作確認 (実 key 必要)
pnpm --filter @revolution/ai-writer debug:vision
```

## デプロイ

| 対象 | コマンド |
|---|---|
| Frontend (Vercel) | main へのマージで自動デプロイ。手動は `pnpm deploy:frontend` |
| AI Writer (Cloud Run) | GitHub Actions 自動デプロイ ([`ai-writer-cloud-run.md`](./ai-writer-cloud-run.md)) |
| ドキュメントサイト (Vercel) | main へのマージで自動デプロイ (docs の入力が変わった時だけビルド。Vercel プロジェクト `revolution-phoenix-docs`、Root Directory `apps/docs`) |

### Vercel の Preview と、ビルドする条件

この仕組みは、Vercel Hobby の deploy の上限 (1 日 100 回。ビルドを止めた deploy も数えられる) に合わせて入れた。今のプランは Pro で上限は大きい ([Limits](https://vercel.com/docs/limits)) が、要らないビルドを作らないために、deploy は要る時だけ作る。

| | Preview | Production (main へのマージ) |
|---|---|---|
| Frontend | PR に `preview` のラベルがある時だけ。付けた時と、その後の frontend の入力を変えた push で作る | 毎回ビルドする (build の時に private の templates から口コミの審査のプロンプトを取り込むため。templates だけの変更は、templates の repo の Deploy Hook が本番を作り直す) |
| ドキュメントサイト | docs の入力を変えた push で作る (ラベルは要らない) | docs の入力が変わった時だけビルドする |

- 仕組み: Git からの自動 deploy は main 以外で止めている (`apps/*/vercel.json` の `git.deploymentEnabled`。パターン `**` は `/` を含む branch 名にも当たる)。Preview は [`.github/workflows/vercel-preview.yml`](../.github/workflows/vercel-preview.yml) が Vercel の API で作る。「入力を変えた」は、その branch で最後に作った Preview の commit (無ければ base との分岐点) と比べる。本番は Git からの自動 deploy のまま、[`scripts/vercel-ignore-build.sh`](../scripts/vercel-ignore-build.sh) (Ignored Build Step) が docs の入力の変化を見る
- 入力の一覧と比べ方は `scripts/vercel-ignore-build.sh` の 1 か所にある (`--paths <frontend|docs>` で一覧、`--changed <frontend|docs> <from> <to>` で変わったか)。Preview の判定も docs の本番の判定も、これを使う。frontend には Ignored Build Step を置かない (本番は毎回ビルドする)
- 環境変数やプロジェクト設定だけを変えた時、ドキュメントサイトは commit に差分が出ないので本番をビルドしない。反映するには Vercel の Redeploy で「Use project's Ignore Build Step」を外す
- この仕組みより前に切った branch には新しい `vercel.json` が無いので、push のたびに自動の Preview が作られる (回数に数えられる)。main を取り込むと止まる
- 画面の確認は、ふだんは手元の開発サーバーで行う。Vercel の環境 (環境変数・R2 など) で見たい PR にだけ `preview` のラベルを付ける

## ドキュメント関連

| コマンド | 説明 |
|---|---|
| `pnpm docs:sync` | docs/ を iCloud に同期 (iPad 閲覧用) |
| `pnpm docs:create` | ドキュメント作成 + 同期ヘルパー |

## 環境セットアップ

pnpm は `package.json` の `packageManager` で 12 系に固定しています。pnpm 11 以上が入っていれば固定の版へ自動で切り替わります。pnpm 10 からは切り替えられないので、pnpm 11 以上にするか `corepack enable` を使ってください。

```bash
pnpm install              # 依存関係インストール
pnpm sync:templates       # private templates リポジトリから YAML 同期
cp .env.sample .env.local  # 環境変数テンプレート (SSOT、要 API key 設定)
```

## キャッシュクリア

```bash
pnpm clean                # turbo cache + dist 削除
pnpm fresh                # clean + install (依存関係再構築)
```
