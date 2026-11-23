/** 管理アプリのサーバー (Node.js) の Sentry。DSN は管理アプリ用の project (revolution-admin) */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // 口コミの本文や会員の情報をイベントに載せない
  sendDefaultPii: false,
});
