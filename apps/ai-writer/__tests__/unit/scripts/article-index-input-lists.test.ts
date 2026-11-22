/**
 * 記事の索引 (article-index.json) を作るスクリプトの入力の一覧が、ずれていないことを確かめる
 *
 * 索引はコミットせず、frontend の build の前に作る。そのため、索引を作るスクリプトと、それが
 * 実行時に読み込むファイルは、frontend の build の入力として次の 3 か所に手で並べてある:
 * - apps/frontend/turbo.json の build / type-check の inputs (turbo のキャッシュ)
 * - scripts/vercel-ignore-build.sh の MUST_BUILD_PATHS (Vercel の Preview をビルドするか)
 * - .github/workflows/ingest-occurrences.yml の push の paths (staging への取り込み)
 * スクリプトの import を増やしてどれかに足し忘れると、古いキャッシュ・Preview のスキップ・
 * 取り込みの漏れが黙って起きるので、ここで止める。
 * apps/ai-writer/package.json は turbo の inputs にだけ置く (turbo は frontend が依存しない
 * ai-writer の依存の版をハッシュに入れないため)。Vercel の判定は pnpm-lock.yaml の変更で足りる。
 * 取り込みは依存の更新では走らせない (次の記事のマージか、手動の実行で反映する)
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { dirname, join, relative, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const GENERATOR = 'apps/ai-writer/scripts/generate-article-index.ts';

/**
 * import / export ... from の相対パス (import type / export type は除く)。引用符はどちらでもよい。
 * パッケージの import (`js-yaml`、`@revolution/schemas` など) は対象外: 依存の版は lockfile が、
 * 型だけの import は実行時の出力に関わらない
 */
const RELATIVE_FROM =
  /^(?:import|export)\s+(?!type\b)[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm;
/** 動的 import と require は書き方を追いきれないので、使われたら落として一覧の扱いを決めさせる */
const UNSUPPORTED = /\bimport\s*\(|\brequire\s*\(/;

/** 相対 import の行き先を探す。見つからなければ落とす (見逃して通るのを防ぐ) */
function resolveImport(fromFile: string, specifier: string): string {
  const base = resolve(REPO_ROOT, dirname(fromFile), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`cannot resolve '${specifier}' imported from ${fromFile}`);
  }
  return relative(REPO_ROOT, found);
}

/** 実行時に読み込む相対 import をたどり、リポジトリのルートからのパスで返す */
function collectRuntimeImports(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(REPO_ROOT, file), 'utf-8');
    if (UNSUPPORTED.test(source)) {
      throw new Error(`${file} uses a dynamic import or require; update this test and the lists`);
    }
    for (const match of source.matchAll(RELATIVE_FROM)) {
      queue.push(resolveImport(file, match[1]));
    }
  }
  return [...seen].sort();
}

describe('article index generator input lists', () => {
  const files = collectRuntimeImports(GENERATOR);

  it('finds the generator and at least one of its imports', () => {
    expect(files).toContain(GENERATOR);
    expect(files.length).toBeGreaterThan(1);
  });

  it('lists every file in the frontend turbo inputs (build and type-check)', () => {
    const turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/frontend/turbo.json'), 'utf-8'));
    for (const task of ['build', 'type-check']) {
      const inputs: string[] = turbo.tasks[task].inputs;
      const missing = files.filter((file) => !inputs.includes(`$TURBO_ROOT$/${file}`));
      expect({ task, missing }).toEqual({ task, missing: [] });
    }
  });

  it('lists every file in MUST_BUILD_PATHS of vercel-ignore-build.sh', () => {
    const script = readFileSync(join(REPO_ROOT, 'scripts/vercel-ignore-build.sh'), 'utf-8');
    const paths = script.match(/MUST_BUILD_PATHS=\(([\s\S]*?)\n\)/)![1]
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean);
    const missing = files.filter((file) => !paths.includes(file));
    expect(missing).toEqual([]);
  });

  it('lists every file in the push paths of ingest-occurrences.yml', () => {
    // YAML として読み、on.push.paths だけを見る (コメントや paths-ignore の行に一致させない)
    const workflow = yaml.load(
      readFileSync(join(REPO_ROOT, '.github/workflows/ingest-occurrences.yml'), 'utf-8')
    ) as { on: { push: { paths: string[] } } };
    const paths = workflow.on.push.paths;
    const missing = files.filter((file) => !paths.includes(file));
    expect(missing).toEqual([]);
  });
});
