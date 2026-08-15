# Sentry (エラー監視 + トレーシング)

`apps/ai-writer` と `apps/frontend` の両方に `@sentry/nextjs` を導入している。本ドキュメントは
**構成の正本**であり、計装を追加する人が最初に読むもの。

## なぜ入れたか

`apps/ai-writer` は Cloud Run で**無人稼働**している (`app/api/cron/rss` を Cloud Scheduler が叩く) が、
導入前は本番の観測手段が実質ゼロだった:

- logger 不在 (`pino` は依存にあるが import 0 件)
- AI 呼び出しの観測ログ `lib/ai/observability/ai-call-recorder.ts` は `NODE_ENV === 'production'` で無効
- `lib/services/article-generation-mdx.service.ts` はパイプライン全体を catch して `{ success: false }` を
  返すだけで、どの step で落ちても例外が消える

つまり「動いていない」ことにすら気づけない状態だった。

## 2 project 構成

| アプリ | Sentry project | 実行環境 | DSN の渡し方 |
|---|---|---|---|
| `apps/ai-writer` | `revolution-ai-writer` | Cloud Run (Docker) | build-arg + `--set-env-vars` の 2 経路 |
| `apps/frontend` | `revolution-frontend` | Vercel | Vercel 環境変数 (Production + Preview) |

org は `we-are-all-one`。**project を分けているので DSN の取り違えに注意する** — 誤った DSN でも
イベントは正常に飛ぶため、間違いに気づけない。DSN 末尾の projectId を Client Keys 画面と照合すること。

> **DSN は秘密ではない**。公開前提の値でブラウザバンドルに含まれる。ただし**コードに平文で書かない** —
> 環境ごとに差し替えられなくなるため、必ず env 経由にする。
> 一方 `SENTRY_AUTH_TOKEN` (`sntrys_` で始まる) は**真の秘密**で、絶対にコミットしない。

## 環境変数

| 変数 | 用途 | 必要なタイミング | 置き場所 |
|---|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | クライアント + ビルド時 | **build 時のみ** | GitHub Variables (`SENTRY_DSN_AI_WRITER`) / Vercel |
| `SENTRY_DSN` | サーバ runtime (ai-writer) | runtime | Cloud Run `--set-env-vars` |
| `SENTRY_ENVIRONMENT` | 環境名 | runtime | Cloud Run `--set-env-vars` (未設定なら `NODE_ENV`) |
| `SENTRY_AUTH_TOKEN` | source map アップロード | **build 時のみ** | GitHub Secrets / Vercel (Sensitive ON) |
| `SENTRY_RELEASE` | release 名 | build 時 | CI が `github.sha` を注入 |

### DSN が 2 本立てになる理由 (冗長ではない)

Next.js は `NEXT_PUBLIC_*` を**バンドル時にリテラル置換**する。したがって:

- `NEXT_PUBLIC_SENTRY_DSN` は runtime に同名で注入しても**読まれない** → build-arg で渡す必要がある
- `SENTRY_DSN` は prefix が無いので inline されず runtime に読める → **同一イメージのまま環境を切り替えられる**

`sentry.server.config.ts` は `SENTRY_DSN || NEXT_PUBLIC_SENTRY_DSN` の順で解決するため、
ローカル (`.env.local` に `NEXT_PUBLIC_` だけ書く) でも動く。

> **`??` ではなく `||` を使う**。`??` は `null` / `undefined` でしかフォールバックしないため、
> `SENTRY_DSN` を**空文字で設定**すると（Cloud Run / Vercel の env で起こりうる）
> フォールバックが働かず SDK が無言で no-op になる。4 つの設定ファイルすべてで `||` に揃えてある。

### GitHub 側だけ変数名が違う理由

GitHub Variables に入る DSN は **ai-writer の 1 本だけ** (frontend は GitHub Actions からデプロイされない)。
汎用名 `NEXT_PUBLIC_SENTRY_DSN` で置くと、将来 `ci.yml` の frontend build に DSN を渡したくなったときに
**ai-writer の値が無警告で frontend に混入する**。`SENTRY_DSN_AI_WRITER` と名前を分けることで
この事故が構造的に起きなくなる。

## Cloud Run では flush が必須

Cloud Run は `--min-instances 0` かつ**レスポンス送出後に CPU が throttle される**。
「返してから背後で送る」型の非同期処理は完走しない。

SDK v10 の `flushIfServerless` は `K_SERVICE` で Cloud Run を検出し App Router の route handler を
自動 flush するが、**handler が return した後に走る処理は救えない**。

| 場所 | 対応 |
|---|---|
| `app/api/cron/rss/route.ts` | `finally { await flushSentry(2000) }`。async 関数の finally は await 完了後に return されるため安全 |
| `app/api/debug/generate-from-feed-mdx/route.ts` | handler は stream を返した時点で return し実処理は `start()` 内で走る = **自動 flush の射程外**。stream を閉じる 3 経路すべてで `controller.close()` の直前に await する |
| その他の API routes | 不要 (自動 flush で足りる) |

`flushSentry()` は `lib/observability/sentry.ts` にあり、失敗しても業務処理を落とさない
(監視の失敗で本番が止まるのは本末転倒)。

## ⚠️ 計装ポイントは 2 系統ある

`app/api/cron/rss/route.ts` は**独自の `runMdxPipeline()` を内包**しており、
18 step 本体の `ArticleGenerationMdxService.generateMdxFromRSS()` を**呼んでいない**。

| 経路 | カバーする計装 |
|---|---|
| cron (Cloud Scheduler) | route の catch (`tags: entrypoint=cron`) |
| SSE (管理 UI) / CLI | service の catch (`tags: pipeline=mdx`) |

**片方にだけ入れると、もう片方が観測ゼロになる。** 計装を足すときは必ず両方を確認すること。

## 計装の判断基準 (3 分類)

新しく計装を足すときは、この 3 つのどれかに割り当てる。

> **`captureException`** = 誰かが起きて対応すべきもの
> **`addBreadcrumb`** = 対応すべき事象が起きたときに原因を知りたいもの
> **何もしない** = ユーザー入力起因で日常的に起きるもの

無料枠 (Developer plan) は **Errors 5K / 月**。日常的に起きるものを拾うと即座に溶ける。

### 通知との対応

Developer plan の priority 判定は **log level のみ**で決まり、Alert Rule は
「High priority issue」だけをメール通知するよう設定してある。したがって:

| 分類 | level | priority | メール |
|---|---|---|---|
| `captureException` | `error` | High | ✅ 飛ぶ |
| `captureMessage(..., 'warning')` | `warning` | Medium | ❌ 飛ばない |

**3 分類がそのまま通知要否になる**ので、追加設定なしで「対応すべきものだけが飛ぶ」。

### `beforeSend` による選別

`lib/observability/sentry.ts` の `beforeSendFilter` (named export、単体テスト済み):

- `DuplicateSlugError` → **drop**。同一記事の再投入で日常的に起き、呼び出し側は 409 を返して正常処理している
- `retryable === true` の GitHub エラー → `level: 'warning'` へ降格

> **⚠️ `DuplicateSlugError` の除外方法は経路によって違う (意図的)。**
>
> | 経路 | 方法 | なぜ |
> |---|---|---|
> | `cron/rss/route.ts` | `instanceof` で分岐し **captureException を呼ばない** | 同じ catch で 409 を返す分岐がすでにあり、そこに 1 行足すだけで済む。SDK まで往復させる必要がない |
> | `article-generation-mdx.service.ts` の全体 catch | **常に captureException し `beforeSendFilter` で drop** | 18 step 全体を包む catch で、ここに来る例外の種類を列挙できない。個別に除外を書くと**除外リストの保守が必要になる**ため、選別は `beforeSendFilter` に一元化する |
>
> つまり **「例外の種類が特定できる箇所は呼ばない / 特定できない箇所は送って filter に任せる」** が方針。
> 新しく計装を足すときもこの基準で選ぶ。結果はどちらも「送信されない」で同じ。

### Server Actions は throw しない

frontend の Server Actions は Result パターン (`{ ok: false }`) を返すため、
`instrumentation.ts` の `onRequestError` に**一切乗らない**。個別に `captureException` しない限り
永久に観測できない。ただし全部拾うと枠が溶けるので、判定は:

> **ユーザー入力に帰責するものは捨て、インフラ / DB に帰責するものだけ拾う**

捨てる代表例: zod parse 失敗 / `PG_UNIQUE_VIOLATION` (username 重複・二重 like) /
`verifyOtp` 失敗 (コードの打ち間違い) / 未ログイン。
**捨てる側も `__tests__/actions/sentry-instrumentation.test.ts` でコントラクト化してある**
(「念のため拾う」への揺り戻しを防ぐため)。

## CSP (frontend)

`next.config.mjs` の `headers()` が `NEXT_PUBLIC_SENTRY_DSN` から `URL.origin` を導出し、
`connect-src` に追加する。`*.sentry.io` のワイルドカードは使わない (リージョン変更に追従し許可範囲が最小)。
`URL.origin` は userinfo (DSN の public key) を含まないため CSP に載せて安全。

> ⚠️ **`headers()` は build 時に評価される**。`NEXT_PUBLIC_SENTRY_DSN` が Vercel の
> Production / Preview 両方に無いとエントリが黙って抜け、**クライアントのイベントが全滅するのに
> 何のエラーも出ない**。

## テスト

`@sentry/nextjs` は `jest.config.mjs` の `moduleNameMapper` で**常に手動 mock**
(`__mocks__/@sentry/nextjs.ts`) へ解決される。

`transformIgnorePatterns` を緩める案は却下した — 実体は `@sentry/node` / `@opentelemetry/*` の
巨大依存を引き、遅く、OTel は Node 固有 API 依存で jsdom 環境 (ai-writer) では壊れるため。
resolver 層で差し替えれば transform 自体が走らない。

各テストで `jest.mock()` を書く方式も却下 (書き忘れ 1 箇所で CI が謎に落ちる)。

### 計装テストを書くときの落とし穴 2 つ

**1. `jest.resetModules()` + 動的 import の suite では Sentry を取り直す**

テストファイル冒頭で静的 import した `@sentry/nextjs` は、`resetModules()` 後に
対象モジュールが掴むものと**別インスタンス**になり、呼び出しを観測できない
(assertion が「0 回」で空振りする)。対象を import した後に同じレジストリから取り直すこと。

```ts
const sentry = (await import('@sentry/nextjs')) as unknown as { captureMessage: jest.Mock };
```

**2. 「呼ばれないこと」の検証は gitignored な YAML に依存させない**

`apps/ai-writer/templates/` と `config/` は private リポジトリから `pnpm sync:templates` で
同期される **gitignored ディレクトリで、CI ランナーには存在しない**。
`getMediaTypeMapperService()` / `getMediaFormResolverService()` 等はこれを読むため、
正常系を実体で通そうとすると **CI でだけ catch へ落ちて「captureMessage が呼ばれないはず」が反転する**。

`ci.yml` は YAML 依存の suite を `testPathIgnorePatterns` で除外しているが、
**その一覧に無いファイルは CI で実行される**。正常系を検証したい場合は
依存サービスを mock し、必要なら別ファイルに分離すること
(例: `__tests__/unit/lib/services/content-generation-sentry.test.ts`)。

## 現在の設定

| 項目 | 値 | 備考 |
|---|---|---|
| `tracesSampleRate` | 両アプリ 0.1 | Spans 枠は 5M/月 と余裕があるが、機能が固まるまで保守的に運用する |
| Session Replay | **入れない** | 無料枠 50/月 で監視に足りず、`worker-src` の CSP 追加も要る |
| Logs | **入れない** | logger 導入は別タスク |
| `deleteSourcemapsAfterUpload` | 両アプリ `true` を明示 | v10 の既定も true だが、将来の既定変更で `.map` が公開されるのを防ぐ |
| `sendDefaultPii` | `false` | |

## 関連

- `apps/ai-writer/lib/observability/sentry.ts` — `flushSentry` / `beforeSendFilter`
- `apps/*/instrumentation.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` / `instrumentation-client.ts`
- [ai-writer-cloud-run.md](./ai-writer-cloud-run.md) — Cloud Run デプロイ全体
- 公式: [Sentry Next.js SDK](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
