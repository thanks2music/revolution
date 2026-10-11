import rootConfig from '../../eslint.config.mjs';

// root の ignores は root からの相対パスなので、このアプリの生成物はここで外す。
const config = [
  ...rootConfig,
  {
    ignores: ['.next/**', '.source/**', 'next-env.d.ts'],
  },
];

export default config;
