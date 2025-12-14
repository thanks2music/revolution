#!/usr/bin/env node
/**
 * 記事インデックス生成スクリプト
 *
 * content/ をスキャンし、全記事のメタデータを収集して
 * apps/frontend/lib/mdx/article-index.json に出力
 *
 * Phase 0.1対応:
 *   - content/articles/ (既存記事)
 *   - content/collabo-cafe/ (AI Writer生成記事)
 *   - content/{event-type}/ (その他イベントタイプ)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(REPO_ROOT, 'apps', 'ai-writer', 'content');
const OUTPUT_PATH = path.join(REPO_ROOT, 'apps', 'frontend', 'lib', 'mdx', 'article-index.json');

/**
 * Frontmatterを抽出
 */
function extractFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const frontmatterText = match[1];
  const frontmatter = {};

  // 簡易YAMLパース（配列・複雑な構造は未対応）
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();

    // 配列判定
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = JSON.parse(value.replace(/'/g, '"'));
    } else {
      // 文字列・数値・日付
      frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }

  return frontmatter;
}

/**
 * ディレクトリを再帰スキャン
 */
async function scanDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // 再帰
      const subFiles = await scanDirectory(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * メイン処理
 */
async function main() {
  console.log('📝 Scanning articles directory:', CONTENT_DIR);

  // content/articles/ 存在確認
  try {
    await fs.access(CONTENT_DIR);
  } catch {
    console.error('❌ Content directory not found:', CONTENT_DIR);
    process.exit(1);
  }

  // 記事ファイル収集
  const articleFiles = await scanDirectory(CONTENT_DIR);
  console.log(`Found ${articleFiles.length} article files`);

  // Frontmatter抽出
  const articles = [];
  for (const filePath of articleFiles) {
    const content = await fs.readFile(filePath, 'utf-8');
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter) {
      console.warn(`⚠️  No frontmatter in ${path.relative(CONTENT_DIR, filePath)}`);
      continue;
    }

    // 必須フィールド検証
    if (!frontmatter.slug || !frontmatter.title || !frontmatter.date) {
      console.warn(`⚠️  Missing required fields in ${path.relative(CONTENT_DIR, filePath)}`);
      continue;
    }

    // パス解析: content/{event_type}/{work_slug}/{filename}.mdx
    const relativePath = path.relative(CONTENT_DIR, filePath);
    const pathParts = relativePath.split(path.sep);

    // イベント種別と作品スラッグを抽出
    let eventType = null;
    let workSlug = null;

    if (pathParts.length >= 3) {
      // 通常のイベント記事: content/collabo-cafe/sample-work/01kafsdmvd.mdx
      eventType = pathParts[0];
      workSlug = pathParts[1];
    } else if (pathParts.length === 2 && pathParts[0] === 'articles') {
      // レガシー記事: content/articles/hello-mdx.md
      eventType = 'articles';
      workSlug = null;
    }

    articles.push({
      slug: frontmatter.slug,
      title: frontmatter.title,
      date: frontmatter.date,
      excerpt: frontmatter.excerpt || '',
      categories: frontmatter.categories || [],
      tags: frontmatter.tags || [],
      author: frontmatter.author || 'Revolution AI Writer',
      filePath: path.relative(REPO_ROOT, filePath),
      eventType,
      workSlug,
    });
  }

  console.log(`✅ Extracted metadata from ${articles.length} articles`);

  // 日付降順ソート
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 出力ディレクトリ作成
  const outputDir = path.dirname(OUTPUT_PATH);
  await fs.mkdir(outputDir, { recursive: true });

  // JSON出力
  const output = {
    generatedAt: new Date().toISOString(),
    totalArticles: articles.length,
    articles,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  console.log('✅ Article index generated:', OUTPUT_PATH);
  console.log(`Total articles: ${articles.length}`);
}

main().catch(error => {
  console.error('❌ Error generating article index:', error);
  process.exit(1);
});
