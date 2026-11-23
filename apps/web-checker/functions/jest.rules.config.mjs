/**
 * Firestore の rules のテスト (Emulator が要る)。`pnpm test:rules` が Emulator を立てて実行する。
 * rules の本体は AI ライターと共有している `apps/ai-writer/firestore.rules`。
 * @type {import('jest').Config}
 */
const config = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['<rootDir>/__tests__/rules.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
  testTimeout: 60_000,
};
export default config;
