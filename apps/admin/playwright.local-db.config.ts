import { defineConfig, devices } from '@playwright/test';

import { getLocalSupabaseEnv } from '../frontend/test-support/local-supabase';

/**
 * 管理アプリの E2E (one-more-time #167)。ローカルの Supabase を向く。
 *
 * 公開サイトの `apps/frontend/playwright.local-db.config.ts` と同じ作法: 接続先は `.env.local` ではなく
 * ローカルの Supabase の値を環境変数で渡す (Next.js は process.env を優先する)。テストの会員とデータは
 * 公開サイトの test-support で作って消す。審査器と写真の置き場所は偽物。
 *
 * ポートは `ADMIN_E2E_PORT` (既定 4477)。公開サイトの E2E (4455) と重ならない値
 */
const port = Number(process.env.ADMIN_E2E_PORT ?? 4477);
const baseURL = `http://localhost:${port}`;
const supabase = getLocalSupabaseEnv();
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e/local',
  // 開発サーバー (next dev) は並列で未組み立てのページを開くと 500 を返すことがある (公開サイトと同じ理由)
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['github']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: isCI ? 'pipe' : 'ignore',
    stderr: 'pipe',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      SUPABASE_SECRET_KEY: supabase.secretKey,
      NEXT_PUBLIC_ADMIN_URL: baseURL,
      NEXT_PUBLIC_SITE_NAME: 'テストのサイト',
      REVIEW_SCREENER: 'fake',
      REVIEW_PHOTO_STORAGE: 'fake',
      GEMINI_API_KEY: '',
    },
  },
});
