import nextJest from 'next/jest.js';

// frontend (Phoenix) への Jest 導入 (Backlog 6gWhvmFm79Jg5qpg / M2)。
// 層別 TDD: Layer1 (純粋関数 = username バリデーション等) +
// Layer2 (外部副作用境界 = Supabase Server Action の mock contract)。
// ai-writer の jest.config.mjs を踏襲しつつ、frontend は現状 jsdom 依存の
// Layer1/2 のみのため testEnvironment は 'node' を既定とする
// (UI コンポーネント = Layer5 Playwright は別系統、M3 以降)。
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

  // path alias 解決 (SWC は transform 時に inline するが、related-test 探索の
  // resolver は解決しないため明示する。ai-writer と同方針)。
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@revolution/schemas/(.*)$': '<rootDir>/../../shared/schemas/$1',
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
