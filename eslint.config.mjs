import next from 'eslint-config-next';

export default [
  ...next,
  {
    // 生成物はどのアプリでも外す (apps/* の eslint は root のこの設定を読み、ignores は root からの相対になるため **/ を付ける)
    ignores: [
      '**/.next/**',
      '**/.source/**',
      'out/**',
      'build/**',
      '**/next-env.d.ts',
      'node_modules/**',
      'pnpm-lock.yaml',
      '.turbo/**',
      'dist/**',
    ],
  },
];
