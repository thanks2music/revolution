import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',

  // Add more setup options before each test is run
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

}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)