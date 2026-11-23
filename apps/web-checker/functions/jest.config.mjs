/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/rules.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
  moduleNameMapper: {
    '^@revolution/net/(.*)$': '<rootDir>/../../../shared/net/$1',
    '^@revolution/schemas/(.*)$': '<rootDir>/../../../shared/schemas/$1',
    '^@revolution/slack/(.*)$': '<rootDir>/../../../shared/slack/$1',
  },
};
export default config;
