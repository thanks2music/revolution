import rootConfig from '../../../eslint.config.mjs';

const config = [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // 履歴の content は Functions が保存した、外のページの生の HTML。HTML として描画すると、
      // 保存した内容から XSS になる。必ず文字として出す (dangerouslySetInnerHTML を使わせない)
      'react/no-danger': 'error',
    },
  },
];

export default config;
