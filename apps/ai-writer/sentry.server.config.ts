/**
 * Sentry 初期化 (Node.js ランタイム)。
 *
 * `instrumentation.ts` の `register()` から `NEXT_RUNTIME === 'nodejs'` の時だけ動的 import される。
 */
import * as Sentry from '@sentry/nextjs';

import { serverSentryOptions } from '@/lib/observability/sentry';

// 共通の設定は lib/observability/sentry.ts にある (定期実行の Job の入口と同じ設定にするため)
Sentry.init(serverSentryOptions());
