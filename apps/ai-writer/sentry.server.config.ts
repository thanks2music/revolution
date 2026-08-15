/**
 * Sentry 初期化 (Node.js ランタイム)。
 *
 * `instrumentation.ts` の `register()` から `NEXT_RUNTIME === 'nodejs'` の時だけ動的 import される。
 */
import * as Sentry from '@sentry/nextjs';

import { beforeSendFilter } from '@/lib/observability/sentry';

Sentry.init({
  // SENTRY_DSN (prefix なし) を優先する。
  // Cloud Run では `--set-env-vars` で runtime に注入され、同一イメージのまま環境を切り替えられる。
  // NEXT_PUBLIC_SENTRY_DSN はビルド時にリテラル置換されるため、ローカル (.env.local に
  // NEXT_PUBLIC_ だけ書いている場合) のフォールバックとして残す。
  // `??` ではなく `||` を使う。`??` は null / undefined でしかフォールバックしないため、
  // Cloud Run で SENTRY_DSN が空文字に設定されると SDK が無言で no-op になる。
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  // release は **あえて指定しない**。
  // ビルド時に withSentryConfig がバンドルへ注入するため、指定すると runtime 側の
  // 未設定な process.env.SENTRY_RELEASE (Cloud Run には渡していない) で上書きしてしまい、
  // source map との紐付けが壊れる。

  tracesSampleRate: 0.1,

  beforeSend: beforeSendFilter,

  // 個人情報をデフォルト送信しない
  sendDefaultPii: false,
});
