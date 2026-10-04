# Slack 通知

デプロイ・migration・main の失敗・occurrence の取り込み・Sentry の issue・記事生成の結果を Slack へ知らせる。
本ドキュメントは**構成の正本**であり、通知を足す・変える人が最初に読むもの。

## しくみ

- Slack App の **bot token + `chat.postMessage`** で送る (Incoming Webhook は使わない)
- **中継サービスは作らない**。イベントが起きる場所 (GitHub Actions の各 workflow / AI Writer のプロセス) から直接送り、
  **送り方の規約だけを共通化**する (中継サービスは新しい障害点になるため)
- 送り先は 2 つ。振り分けの原則は**「運用で人の対応が要るか」**:

| チャンネル | 送るもの | メンション |
|---|---|---|
| 本番系 (`vars.SLACK_CHANNEL_PROD`) | 本番の失敗・要対応 (と本番デプロイの成功) | 失敗・要対応の時だけ |
| 開発系 (`vars.SLACK_CHANNEL_DEV`) | それ以外 (Preview の失敗・ローカルの記事生成・テストモード) | なし |

成功を送るのは、本番のデプロイ (Vercel・Cloud Run・Supabase の migration) とローカルの記事生成だけ。

### 部品

| 部品 | 場所 | 役割 |
|---|---|---|
| composite action | `.github/actions/slack-notify/` | Actions から送る唯一の入口 (curl + jq)。payload の組み立て・エスケープ・テストモード・送信 |
| 文面のスクリプト | `.github/scripts/notify/*.sh` | 各 workflow の結果から text / body / 振り分けを組み立てる (ネットワークに出ない) |
| Sentry の取得 | `.github/scripts/sentry/fetch-issues.sh` | Sentry の issue 一覧 API を読む |
| state の読み込み | `.github/scripts/state/fetch-latest-artifact.sh` | 前回の実行の状態 (artifact) を、main の実行が置いたものだけから読む |
| AI Writer | `apps/ai-writer/lib/slack/` | 記事生成の結果を送る (`config` / `messages` / `client`) |
| smoke | `.github/workflows/slack-notify-smoke.yml` | 上の部品を偽の curl / gh で検証し、開発系へ `[TEST]` を 1 通送る |

## 何が届くか

| 発生源 | 送り先 | メンション | 実装 |
|---|---|---|---|
| Vercel の本番デプロイの成功 / 失敗 | 本番系 | 失敗だけ | `vercel-deploy-notify.yml` (`repository_dispatch`) |
| Vercel の Preview デプロイの失敗 | 開発系 | なし | 同上。デプロイの削除と、権限起因の失敗 (Vercel にアクセスできない人の commit) は送らない |
| AI Writer の Cloud Run デプロイの結果 | 本番系 | 失敗・トラフィックの固定 | `deploy-ai-writer.yml`。ヘルスチェックの失敗時はロールバックの手順を添える |
| Supabase migration (production) の結果 + advisor の新規 lint | 本番系 | 失敗・新規 lint | `deploy-supabase-migrations.yml` (1 通にまとめる) |
| Supabase migration (staging) の失敗 | 開発系 | なし | 同上 (staging の advisor の新規 lint は本番系へメンション付き) |
| Supabase advisor の週次チェック | 本番系 (新規 lint) / 開発系 | 新規 lint | `supabase-advisor-check.yml` |
| Supabase keepalive の失敗 | 本番系 | あり | `supabase-keepalive.yml` |
| main の失敗 (`CI` / `Update MDX Article Index` / `Sentry Digest`) | 本番系 | あり | `notify-main-failures.yml` (`workflow_run`)。定期実行は成功から失敗に変わった最初の 1 回だけ |
| occurrence 取り込みの失敗、対応が要る人手キュー | 本番系 | あり | `ingest-occurrences.yml` |
| Sentry の新規・回帰 issue | 本番系 (本番の priority High) / 開発系 | 本番の High | `sentry-digest.yml` (30 分ごと)。詳細は [sentry.md](./sentry.md) |
| 記事生成のローカル実行 (`pnpm debug:mdx`) | 開発系 | なし | `apps/ai-writer/scripts/debug-mdx-url.ts` |
| 記事生成の cron (Cloud Run) の失敗 | 本番系 | あり | `apps/ai-writer/app/api/cron/rss/route.ts`。**Cloud Run に token を入れるまで休眠** (Cloud Scheduler の稼働時に入れる) |

## 設定

| 置き場所 | キー |
|---|---|
| GitHub secret | `SLACK_BOT_TOKEN` (bot token) / `SENTRY_API_TOKEN` (Sentry の Internal Integration、Issue & Event: Read のみ) |
| GitHub variable | `SLACK_CHANNEL_PROD` / `SLACK_CHANNEL_DEV` / `SLACK_MENTION_USER_ID` |
| AI Writer の env | `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `SLACK_MENTION_USER_ID` (キー名は環境で変えない。`apps/ai-writer/.env.sample`) |

- AI Writer のメンションは Cloud Run の上 (`K_SERVICE` がある時) だけ付く。`op://` のままの値は未設定として扱う
- Slack App のスコープは `chat:write`。bot は 2 つのチャンネルに招待しておく (招待していないと `not_in_channel`)

## composite action の使い方

```yaml
# uses: の SHA は例。実際の値は既存の workflow (例: notify-main-failures.yml) に合わせる
- name: Checkout notification action
  uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    sparse-checkout: |
      .github/actions
    persist-credentials: false

- name: Notify Slack
  uses: ./.github/actions/slack-notify
  with:
    token: ${{ secrets.SLACK_BOT_TOKEN }}
    channel: ${{ vars.SLACK_CHANNEL_PROD }}
    test-channel: ${{ vars.SLACK_CHANNEL_DEV }}
    # メンションは失敗・要対応の時だけ渡す (成功では空にする)
    mention: ${{ steps.result.outputs.failed == 'true' && vars.SLACK_MENTION_USER_ID || '' }}
    text: ❌ 何が起きたかの 1 行
    body: 補足 (生の mrkdwn)                     # 任意
    body-file: body.txt                            # 任意 (body と同じ扱い。ログに出したくない値を含む時)
    blocks-file: blocks.json                       # 任意 (Block Kit の配列)
```

- **`text` はこの action がエスケープする**。`body` は生の mrkdwn として載るので、外部由来の値 (エラー文・ブランチ名など) は呼び出し側で `&` `<` `>` をエスケープする (`<!channel>` が混ざると全員に通知が飛ぶ)
- **`with:` の値は、入力として public な Actions のログに出る**。外部由来の中身 (Sentry の issue のタイトル、Vercel の失敗の理由など) は `body-file` か `blocks-file` で渡し、`text` には件数などだけを書く
- **送信に失敗しても job を落とさない**。`ok:false` の時は warning `Slack notification failed` を残し、output `ok` が `false` になる。token か channel が空なら notice を出して送らない (`skipped`)
- **リトライしない** (二重投稿になるため)。blocks が `invalid_blocks` / `msg_too_long` で拒否された時だけ、要約 (`text`) だけで 1 回送り直す
- **テストモード**: `test: 'true'`、または main 以外の ref からの `workflow_dispatch` で、`test-channel` へ `[TEST]` 付き・メンションなしで送る (例: `[TEST] ❌ main で「CI」が失敗しました (failure)`)。どの ref から動かしても本物になる通知 (本番デプロイ・本番 migration) は `auto-test-mode: 'false'` を付ける

## 通知を足す・変える時の決まり

1. 振り分けは「運用で人の対応が要るか」。要るものだけ本番系にメンション付き
2. **1 実行で同じ送り先に 1 通** (1 つの環境について)。入口 (workflow / CLI / cron route) から送り、ライブラリの中からは送らない (入口でも送ると同じ失敗が 2 通届く)。
   staging と production を 1 回の実行で見る workflow (advisor の週次チェック、keepalive の `target=both`) は、環境ごとに 1 通ずつ送る (中身が別の事象なので、まとめない)
3. 外部由来の値は必ず `& < >` をエスケープする。切り詰めで entity (`&amp;`) やリンク記法 (`<url|text>`) を壊さない
4. 成否は Slack の応答の本文の `ok` で判断する (Web API はエラーでも HTTP 200 を返す)
5. 通知の失敗で本処理を落とさない
6. ログに token・payload・応答を出さない。残すのはエラーコードだけ
7. `uses:` は commit SHA + バージョンのコメントで固定する
8. 「前回との差分」で知らせるもの (advisor の baseline、Sentry の知らせ済みなど) は、**届かなかった時に比較の基準を更新しない** (更新すると、その差分が二度と知らされない)。前回の基準を読めなかった時 (artifact の取得の失敗・タイムアウト) も更新しない。取得できたが壊れている時は「無い」と同じに扱い、今回の状態で置き換える (置き換えないと期限切れまで比べられない)
9. 文面の組み立てはネットワークに出ないスクリプトに分け、smoke (Actions) か Jest (AI Writer) で確かめる。jq は runner の版 (1.7) でも動くことを確かめる (1.8 でしか通らない構文がある)

## 確かめ方

| 確かめたいもの | 方法 |
|---|---|
| composite action・文面のスクリプト | 通知まわりのファイルを変える PR を出す (smoke が走る) |
| 既存の workflow | ブランチから `workflow_dispatch` (テストモード)。⚠️ migration は必ず `-f target=staging`。⚠️ `deploy-ai-writer.yml` はブランチから動かさない (本番デプロイになる) |
| 新しい workflow | default branch に入るまで dispatch できない (GitHub の仕様)。マージ後に dispatch で確かめる |
| AI Writer | `apps/ai-writer` で `pnpm debug:mdx --dry-run <URL>` (`--dry-run` を外すと本物の記事 PR ができる) |

## 既知の制限

- **`workflow_run` は workflow の名前で一致させる**。`notify-main-failures.yml` の対象の `name:` を変えると、通知が黙って止まる (smoke が名前の実在を確かめる)
- **public repo の schedule は、60 日間リポジトリに動きが無いと GitHub に止められる**。止まっても失敗にならない。
  止まったかは `gh workflow list --all` の状態 (`disabled_inactivity`) で分かり、`gh workflow enable <workflow>` で再開する
- **schedule は遅れるし、抜けることもある** (GitHub の公式の説明: 負荷が高い時は遅れ、十分に高ければキューに入ったジョブが落とされることがある)。2026-10-04 の実測で、keepalive (毎日 15:37 UTC) は 3〜5 時間遅れ、Sentry のまとめ (30 分ごと) はマージ後の 8 時間で 1 回しか動かなかった。Sentry のまとめは毎回直近 24 時間を見直し、知らせ済みの記録で重複を除くので、24 時間に 1 回動けば取りこぼさない。届くまでの遅れは、この遅延のぶん長くなる
- checkout より前で job が失敗すると、その job の中からは通知できない (`notify-main-failures` の対象なら、そちらが拾う)
- Vercel の `repository_dispatch` は、repo に write 権限のある token なら送れる。プロジェクトは名前で照合しているので、Vercel でプロジェクトを改名すると通知が止まる
- PR の smoke は `SLACK_BOT_TOKEN` を使う。同じリポジトリのブランチの PR は secret を読めるため、送り先は開発系に固定している
- occurrence 取り込みは毎回全件を対象にするので、未解決の人手キューは記事のマージのたびに再び届く
- ShellCheck も runner と手元で版が違い、ルールの番号が違うことがある (2026-10 時点で runner の `ubuntu-latest` は 0.9、
  手元の Homebrew は 0.11。`disable` は両方の番号を書く)。`ubuntu-latest` の版が上がると変わる

## 関連

- [sentry.md](./sentry.md) — Sentry (Slack へのまとめ通知の仕組みを含む)
- [ai-writer-cloud-run.md](./ai-writer-cloud-run.md) — AI Writer の Cloud Run デプロイ
