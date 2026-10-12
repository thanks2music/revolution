import nextJest from 'next/jest.js';

// frontend の jest.config.mjs に揃える。対象は Layer 1 (純粋関数) と設定の guard だけで、
// 画面は Playwright で確かめる (CI には載せない、BOSS 決定 2026-10-11)。
const createJestConfig = nextJest({
  dir: './',
});

const config = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.(test|spec).{js,jsx,ts,tsx}'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

export default createJestConfig(config);
