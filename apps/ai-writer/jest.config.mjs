import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',

  // Configure jsdom to include Node.js globals
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },

  // Setup files that run BEFORE the test environment is set up
  // This is where we polyfill TextEncoder/TextDecoder and fetch API
  setupFiles: ['<rootDir>/jest.polyfills.mjs'],

  // Add more setup options AFTER each test framework is installed
  setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],

  // カバレッジ設定
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/coverage/**',
  ],

  // タイムアウト設定
  testTimeout: 30000,

  // テストファイルのパターン（test-helpersを除外）
  testMatch: [
    '**/__tests__/**/*.(test|spec).{js,jsx,ts,tsx}',
    '!**/__tests__/test-helpers/**',
  ],

  // Module resolution aliases — must include `@/` so that
  // `jest --findRelatedTests` can walk the dependency graph past path-aliased
  // imports. SWC (next/jest) inlines `@/` at transform time, but the resolver
  // used for related-test discovery does not, and would otherwise miss tests
  // that import their source via `@/lib/...`.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@revolution/schemas/(.*)$': '<rootDir>/../../shared/schemas/$1',
  },

}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)