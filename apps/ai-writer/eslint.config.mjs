import rootConfig from '../../eslint.config.mjs';

/**
 * apps/ai-writer の ESLint 設定
 *
 * Root の eslint.config.mjs (Next.js + Prettier) を継承し、type-aware lint で
 * Promise/Async の型抜け道バグを恒久検出する rule を追加。
 * (@typescript-eslint plugin と parser は eslint-config-next 経由で既に有効)
 *
 * Sprint 1 RCA-driven prevention:
 *   isValidXxx の `Promise<T> !== null` 比較バグ (TypeScript の型抜け道) の再発防止
 *   See notes/04-review/2026-05-05-test-failure-rca.md (gitignored, local only)
 */
export default [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/__tests__/**',
      'coverage/**',
      'scripts/**',
      'jest.*.mjs',
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Sprint 1 RCA target: Promise<T> !== null comparison (detected via checksConditionals)
      // checksVoidReturn is disabled because UI component async handlers (onClick, etc.)
      // are out of Sprint 1 scope. Re-enabling and refactoring those is a separate Backlog task.
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksConditionals: true,
          checksVoidReturn: false,
          checksSpreads: true,
        },
      ],
    },
  },
];
