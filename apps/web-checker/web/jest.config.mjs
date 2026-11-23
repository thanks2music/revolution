import nextJest from 'next/jest.js';

// WEB チェッカーの画面の単体テスト (jsdom)。apps/admin・apps/frontend と同じ作法
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],
  testMatch: ['**/__tests__/**/*.(test|spec).{js,jsx,ts,tsx}'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '<rootDir>/out/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testTimeout: 30000,
};

// @t3-oss/env-nextjs と env-core は ESM だけで配っているので、transform の対象に含める
// (pnpm のフラットな格納名は `@t3-oss+...`)。それ以外の node_modules は next/jest の既定どおり外す
export default async function jestConfig() {
  const resolved = await createJestConfig(config)();
  return {
    ...resolved,
    transformIgnorePatterns: [
      '/node_modules/\\.pnpm/(?!(@t3-oss\\+env-nextjs|@t3-oss\\+env-core)@)',
      '^.+\\.module\\.(css|sass|scss)$',
    ],
  };
}
