import next from 'eslint-config-next';

export default [
  ...next,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'node_modules/**',
      'pnpm-lock.yaml',
      '.turbo/**',
      'dist/**',
    ],
  },
];
