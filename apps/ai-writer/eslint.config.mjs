import rootConfig from '../../eslint.config.mjs';

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
      // checksVoidReturn=false: existing UI async handlers (onClick etc.) intentionally
      // pass Promise-returning functions where void is expected; tracked separately.
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
