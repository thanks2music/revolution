import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Functions は Next.js ではないので、repo 直下の設定 (eslint-config-next) は読まない
const config = [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ['src/**/*.ts'] })),
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: import.meta.dirname },
    },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['__tests__/**/*.ts'] })),
  { files: ['*.mjs'], languageOptions: { globals: { URL: 'readonly' } } },
];

export default config;
