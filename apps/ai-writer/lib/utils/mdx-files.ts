/**
 * MDX ファイル走査ユーティリティ
 *
 * `apps/ai-writer/content/**\/*.mdx` を再帰的に列挙する共通ロジック。
 * `scripts/remove-utm-from-articles.ts` と Layer 1 regression test
 * (`__tests__/unit/lib/mdx/utm-regression.test.ts`) の双方から利用され、
 * drift を防ぐために本モジュールに一元化する。
 *
 * 出力は path による昇順ソート (両呼び出し先で決定的順序を担保)。
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';

/**
 * `rootDir` 配下の `.mdx` ファイルを再帰的に列挙する。
 *
 * @param rootDir 走査開始ディレクトリの絶対パス
 * @returns `.mdx` ファイル絶対パスの配列 (昇順ソート済み)
 */
export async function findMdxFiles(rootDir: string): Promise<string[]> {
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
  return found.sort();
}
