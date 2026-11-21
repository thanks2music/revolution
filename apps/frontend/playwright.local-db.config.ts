import { defineConfig, devices } from '@playwright/test';

import { getLocalSupabaseEnv } from './test-support/local-supabase';
import { MEMBER_STATE_PATH } from './e2e/local/paths';

/**
 * Playwright (会員の操作の E2E。ローカルの Supabase を向く)。
 *
 * `playwright.config.ts` (layout の回帰検証) とは別の設定にしている。あちらは staging の
 * データで描画を比べるため staging を向いた dev サーバを前提にし、こちらはテストが会員と
 * データを作って消すため、必ずローカルの Supabase を向いたサーバで動かす。
 *
 * ## サーバ
 *
 * `webServer` がアプリを起動する。Supabase の接続先 (API の URL・キー・Postgres の接続文字列) は
 * `.env.local` ではなく `test-support/local-supabase.ts` の値を環境変数で渡す (Next.js は `.env.*` より
 * process.env を優先する)。`.env.local` が staging を向いていても、ローカルの DB しか触らない。
 * DB に触る env を足したら、ここにも足すこと。
 *
 * - CI: production build を起動する (`next build && next start`)。dev のページごとのコンパイルで
 *   待ち時間がぶれないようにするため
 * - 手元: `next dev`。既に動いている dev サーバは使い回さない (それが staging を向いていると、
 *   ローカルで作った会員でログインできず、原因の分かりにくい失敗になるため)
 *
 * ポートは `E2E_PORT` (既定 4455)。worktree の dev サーバ (4444 や `.worktree.env` のポート) と
 * 重ならない値にしている。
 *
 * ## ログインの状態
 *
 * `setup` プロジェクトが会員を 1 人作り、その cookie を `MEMBER_STATE_PATH` に保存する。
 * 会員として動くテストは `member` プロジェクトに置き、保存した状態から始まる。
 * 全テストが終わると `teardown` プロジェクトが会員を消す。
 */
const port = Number(process.env.E2E_PORT ?? 4455);
const baseURL = `http://localhost:${port}`;
const supabase = getLocalSupabaseEnv();
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e/local',

  // テストごとにデータを分けるので並列にできる。CI は 2 コアなので 1 に抑える
  workers: isCI ? 1 : undefined,
  fullyParallel: true,
  forbidOnly: isCI,
  // CI の初回だけ 1 回やり直す (落ちた時の trace を残すため)。やり直して通ったものは flaky として報告される
  retries: isCI ? 1 : 0,

  reporter: isCI ? [['list'], ['github']] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      teardown: 'teardown',
    },
    {
      name: 'teardown',
      testMatch: /.*\.teardown\.ts/,
    },
    {
      name: 'member',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: MEMBER_STATE_PATH },
    },
  ],

  webServer: {
    command: isCI
      ? `pnpm exec next build && pnpm exec next start --port ${port}`
      : `pnpm exec next dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    // CI の build を含めて待つ
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      SUPABASE_SECRET_KEY: supabase.secretKey,
      DATABASE_URL: supabase.dbUrl,
      MIGRATION_DATABASE_URL: supabase.dbUrl,
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
});
