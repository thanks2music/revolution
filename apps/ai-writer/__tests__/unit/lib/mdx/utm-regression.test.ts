/**
 * UTM 混入回帰検出 (Layer 1 regression gate)
 *
 * Sprint C-β P14: `collabo-cafe.com` origin から抽出された utm 付き URL が
 * 既存 MDX 記事や derived article-index.json に混入することを CI 段階で捕捉する。
 * `remove-utm-from-articles.ts` script 実行忘れや、Templates 側で utm ルールが
 * 誤って再導入されるケースへの safety net。
 *
 * 検出方針: `utm_source=collabo` 等の完全一致パターンを regex 検索する
 * (`stripUtmFromUrl` の一般化された utm_* 除去より narrow に絞り、
 *  正当な utm_* 使用 = collabo-cafe.com origin 以外 = があった場合に
 *  false positive を出さない)。
 */

import { describe, it, expect } from '@jest/globals';
import { readdir, readFile, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';

const AI_WRITER_ROOT = resolve(__dirname, '..', '..', '..', '..');
const CONTENT_ROOT = join(AI_WRITER_ROOT, 'content');
const FRONTEND_ARTICLE_INDEX = resolve(
  AI_WRITER_ROOT,
  '..',
  'frontend',
  'lib',
  'mdx',
  'article-index.json',
);

const COLLABO_CAFE_UTM_REGEX = /utm_(?:source|medium|campaign|id)=collabo_cafe_dot_com/i;

async function findMdxFiles(rootDir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const info = await stat(full);
      if (info.isDirectory()) {
        await walk(full);
      } else if (info.isFile() && entry.endsWith('.mdx')) {
        found.push(full);
      }
    }
  }
  await walk(rootDir);
  return found;
}

async function assertNoUtmInFile(filePath: string): Promise<void> {
  const content = await readFile(filePath, 'utf-8');
  const match = content.match(COLLABO_CAFE_UTM_REGEX);
  expect(match).toBeNull();
}

describe('UTM regression gate (Sprint C-β P14)', () => {
  it('MDX 記事に collabo-cafe.com origin の utm 参照が混入していない', async () => {
    const files = await findMdxFiles(CONTENT_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      try {
        await assertNoUtmInFile(file);
      } catch (err) {
        throw new Error(
          `UTM regression detected in ${relative(AI_WRITER_ROOT, file)}\n` +
            `Run \`pnpm --filter ai-writer run clean:utm\` to fix.\n` +
            `Original error: ${(err as Error).message}`,
        );
      }
    }
  });

  it('article-index.json に collabo-cafe.com origin の utm 参照が混入していない', async () => {
    try {
      await assertNoUtmInFile(FRONTEND_ARTICLE_INDEX);
    } catch (err) {
      throw new Error(
        `UTM regression detected in article-index.json.\n` +
          `Run \`pnpm --filter ai-writer run clean:utm && pnpm --filter ai-writer run generate:article-index\` to fix.\n` +
          `Original error: ${(err as Error).message}`,
      );
    }
  });
});
