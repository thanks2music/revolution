import 'server-only';

import { createSlackNotifier, type ReviewNotifier } from '@revolution/reviews/notifications';

import { env } from '@/lib/env';

/**
 * 公開サイトの Slack の通知 (#169)。Slack の env が無い環境 (ローカル・CI・Preview の一部) では何も送らない。
 * 送り先と載せる物の決まりは shared/reviews/notifications.ts
 */
export function getReviewNotifier(): ReviewNotifier {
  return createSlackNotifier({ adminUrl: env.ADMIN_APP_URL });
}
