/**
 * Functions を 1 つのファイルにまとめる。
 *
 * shared/ の package (@revolution/slack など) は pnpm の workspace の依存で、デプロイ先の Cloud Build
 * (npm install) では解決できない。そのため package.json の依存には書かず、ここでバンドルに含める。
 * npm にある依存 (package.json の dependencies) はバンドルせず、デプロイ先で install させる。
 */
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
  tsconfig: 'tsconfig.json',
  logLevel: 'info',
});
