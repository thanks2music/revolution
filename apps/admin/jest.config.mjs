import nextJest from 'next/jest.js';

// 管理アプリ (one-more-time #167) の単体テスト。公開サイト (apps/frontend/jest.config.mjs) と同じ作法。
// 層別 TDD の Layer 1 (表示の言葉・写真の印の純粋関数) が中心。画面の流れは E2E (playwright.local-db.config.ts)。
const createJestConfig = nextJest({
  dir: './',
});

const config = {
  coverageProvider: 'v8',
  testEnvironment: 'node',

  // カバレッジは opt-in (development-principles.md Phase 1 / Jest 公式準拠)。
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'actions/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/coverage/**',
  ],

  testTimeout: 15000,

  testMatch: [
    '**/__tests__/**/*.(test|spec).{js,jsx,ts,tsx}',
    '!**/__tests__/test-helpers/**',
  ],

  testPathIgnorePatterns: ['/node_modules/', '/.next/', '<rootDir>/e2e/'],

  // path alias 解決 (SWC は transform 時に inline するが、related-test 探索の
  // resolver は解決しないため明示する。ai-writer と同方針)。
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@revolution/schemas/(.*)$': '<rootDir>/../../shared/schemas/$1',
    '^@revolution/reviews/(.*)$': '<rootDir>/../../shared/reviews/$1',
    '^@revolution/slack/(.*)$': '<rootDir>/../../shared/slack/$1',
    // `@sentry/nextjs` は常に手動 mock へ解決する。実体は @sentry/node +
    // @opentelemetry/* の巨大依存を引き、transform 対象にすると遅く・壊れやすい。
    // ⚠️ 下の transformIgnorePatterns は触らない (@t3-oss の allowlist を壊さないため)。
    '^@sentry/nextjs$': '<rootDir>/__mocks__/@sentry/nextjs.ts',
  },
};

// next/jest が生成する transformIgnorePatterns に @t3-oss/env-nextjs / env-core を
// allowlist 追加する。Server Action テストは createClient を mock するが、SWC の
// import 評価で lib/env.ts (→ @t3-oss/env-nextjs = ESM-only) のトランスフォームが
// 走るため、これらを transform 対象に含めないと "Cannot use import statement
// outside a module" になる。next/jest のデフォルト node_modules ignore は維持し、
// 必要 2 パッケージだけを除外リストから外す (pnpm のフラット格納名は `@t3-oss+...`)。
export default async function jestConfig() {
  const resolved = await createJestConfig(config)();
  return {
    ...resolved,
    transformIgnorePatterns: [
      // pnpm store 内の env-nextjs / env-core 以外の node_modules は transform しない
      '/node_modules/\\.pnpm/(?!(@t3-oss\\+env-nextjs|@t3-oss\\+env-core)@)',
      '^.+\\.module\\.(css|sass|scss)$',
    ],
  };
}
