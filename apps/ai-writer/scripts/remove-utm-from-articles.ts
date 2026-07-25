/**
 * 既存 MDX 記事から UTM パラメータを一括除去する reusable script
 *
 * Sprint C-β P14: `collabo-cafe.com` origin 記事は AI Writer 抽出時に
 * 確実に `?utm_source=collabo_cafe_dot_com&...&utm_id=collabo_cafe_dot_com`
 * が付与される仕様のため、future の cleanup batch にも同じ script を
 * 再利用できるように pure function (`stripUtmFromUrl`) 経由で書く。
 *
 * 使用方法:
 *   pnpm clean:utm            (実行)
 *   pnpm clean:utm --dry-run  (プレビューのみ、書き込みなし)
 *   pnpm clean:utm --verbose  (変更 URL 単位で詳細ログ)
 *
 * 対象:
 *   `apps/ai-writer/content/{event_type}/{work_slug}/*.mdx`
 *   - frontmatter `official_url` field
 *   - 本文の markdown link `[text](url)` パターン
 *   - 本文中の bare http(s) URL
 *
 * 設計原則:
 *   - Idempotent: 何度実行しても副作用同一
 *     (`stripUtmFromUrl` が既 clean URL に対して no-op を保証)
 *   - Log-friendly: 変更ファイル / 変更 URL を summary で報告
 *   - Dry-run 対応: 実 write なしで対象と変更内容を確認可能
 *
 * @module scripts/remove-utm-from-articles
 */

import { fileURLToPath } from 'url';
import { dirname, resolve, relative } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { stripUtmFromUrl } from '../lib/utils/url';
import { findMdxFiles } from '../lib/utils/mdx-files';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliArgs {
  dryRun: boolean;
  verbose: boolean;
}

interface CleanupReport {
  scannedFiles: number;
  modifiedFiles: number;
  cleanedUrls: number;
  modifiedFilePaths: string[];
}

/** 本文中の絶対 URL を検出する regex (markdown link / bare URL / frontmatter 値の quoted URL いずれもマッチ) */
const URL_REGEX = /https?:\/\/[^\s"'`)<>\]]+/g;

function parseArgs(argv: string[]): CliArgs {
  return {
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
  };
}

async function processFile(
  filePath: string,
  args: CliArgs,
  contentRoot: string,
): Promise<{ modified: boolean; cleanedCount: number }> {
  const original = await readFile(filePath, 'utf-8');
  let cleanedCount = 0;

  const updated = original.replace(URL_REGEX, (match) => {
    const stripped = stripUtmFromUrl(match);
    if (stripped !== match) {
      cleanedCount++;
      if (args.verbose) {
        const rel = relative(contentRoot, filePath);
        console.log(`  [${rel}]`);
        console.log(`    - ${match}`);
        console.log(`    + ${stripped}`);
      }
      return stripped;
    }
    return match;
  });

  if (cleanedCount === 0) {
    return { modified: false, cleanedCount: 0 };
  }

  if (!args.dryRun) {
    await writeFile(filePath, updated, 'utf-8');
  }

  return { modified: true, cleanedCount };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const contentRoot = resolve(__dirname, '..', 'content');
  console.log('=== remove-utm-from-articles ===');
  console.log(`  mode:         ${args.dryRun ? 'DRY-RUN (no writes)' : 'LIVE'}`);
  console.log(`  content root: ${contentRoot}`);
  console.log('');

  const files = await findMdxFiles(contentRoot);
  console.log(`Scanning ${files.length} MDX file(s)...`);
  console.log('');

  const report: CleanupReport = {
    scannedFiles: files.length,
    modifiedFiles: 0,
    cleanedUrls: 0,
    modifiedFilePaths: [],
  };

  for (const file of files) {
    const { modified, cleanedCount } = await processFile(file, args, contentRoot);
    if (modified) {
      report.modifiedFiles++;
      report.cleanedUrls += cleanedCount;
      report.modifiedFilePaths.push(relative(contentRoot, file));
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Scanned files:  ${report.scannedFiles}`);
  console.log(`  Modified files: ${report.modifiedFiles}`);
  console.log(`  Cleaned URLs:   ${report.cleanedUrls}`);
  if (report.modifiedFiles > 0) {
    console.log(`  Modified paths:`);
    for (const p of report.modifiedFilePaths) {
      console.log(`    - ${p}`);
    }
  }
  if (args.dryRun && report.modifiedFiles > 0) {
    console.log('');
    console.log('(dry-run: no files were actually written)');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
