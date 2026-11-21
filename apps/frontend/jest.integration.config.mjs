import unitJestConfig from './jest.config.mjs';

/**
 * 結合テスト (ローカルの Supabase の実 DB に対して叩く) の jest の設定。
 *
 * `pnpm test` (jest.config.mjs) は DB を必要としない単体テストだけを走らせ、
 * `__tests__/integration/` を除外している。結合テストは `pnpm test:integration` で走らせる。
 *
 * 単体テストの設定を土台にし、テストの探し方と待ち時間だけを変える。Server Action や
 * `lib/env.ts` を import するテストが、単体テストと同じ alias・`@sentry/nextjs` の mock・
 * `@t3-oss/env-*` の transform で読み込めるようにするため。
 *
 * 前提: `supabase start` でローカルの Supabase が動いていること
 * (接続先の決め方と、ローカル以外を拒む理由は `test-support/local-supabase.ts`)。
 */
export default async function jestIntegrationConfig() {
  const base = await unitJestConfig();
  return {
    ...base,
    testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/.next/'],
    // 実 DB への往復があるため、単体テストより長く待つ
    testTimeout: 30000,
  };
}
