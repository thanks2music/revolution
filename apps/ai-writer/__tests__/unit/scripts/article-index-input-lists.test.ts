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
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const GENERATOR = 'apps/ai-writer/scripts/generate-article-index.ts';

/** 実行時に読み込む相対 import (import type は除く) をたどり、リポジトリのルートからのパスで返す */
function collectRuntimeImports(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(REPO_ROOT, file), 'utf-8');
    for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gm)) {
      const target = relative(REPO_ROOT, resolve(REPO_ROOT, dirname(file), `${match[1]}.ts`));
      queue.push(target);
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
    const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/ingest-occurrences.yml'), 'utf-8');
    const missing = files.filter((file) => !workflow.includes(`- "${file}"`));
    expect(missing).toEqual([]);
  });
});
