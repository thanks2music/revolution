/**
 * 管理アプリの環境変数 (@t3-oss/env-nextjs)。値の一覧と BOSS の設定手順は .env.sample と
 * one-more-time の docs (管理アプリの手順書)。
 *
 * 写真の置き場所 (REVIEW_R2_* と配信・CDN)・審査 (GEMINI_API_KEY など)・偽物 (REVIEW_SCREENER /
 * REVIEW_PHOTO_STORAGE)・Slack の通知 (SLACK_*、#169) は、公開サイトと同じく shared/reviews が process.env を
 * 直に読む。ここには書かない (値の一覧は .env.sample)
 */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // 配信側への写し・消しと、もう一度 AI にかけた後の審査に使う (admin を確かめた後だけ)
    SUPABASE_SECRET_KEY: z.string().startsWith('sb_secret_').optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    // 管理アプリの URL (Google ログインの戻り先の確認に使う。例: https://admin.〜)
    NEXT_PUBLIC_ADMIN_URL: z.string().url().optional(),
    // 上の帯に出すサイト名 (公開サイトと同じ値)
    NEXT_PUBLIC_SITE_NAME: z.string().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_ADMIN_URL: process.env.NEXT_PUBLIC_ADMIN_URL,
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
