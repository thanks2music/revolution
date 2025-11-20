import fs from 'fs';
import path from 'path';

/**
 * WordPress互換のメタデータ構造
 * Phase 1で必要な全フィールドを定義
 */
export interface ArticleMetadata {
  id: string;
  title: string;
  slug: string;
  date: string; // ISO 8601 format
  categories: string[];
  tags: string[];
  excerpt: string;
  author: string;
  ogImage?: string;
  featuredImage?: string; // WordPress互換
}

export interface Article {
  metadata: ArticleMetadata;
  slug: string;
  content: string;
}

/**
 * frontmatterをパースする
 * @param fileContent MDXファイルの全内容
 * @returns メタデータと本文
 */
export function parseFrontmatter(fileContent: string): {
  metadata: Partial<ArticleMetadata>;
  content: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
  const match = frontmatterRegex.exec(fileContent);

  if (!match) {
    throw new Error('Frontmatter not found in MDX file');
  }

  const frontmatterBlock = match[1];
  const content = fileContent.replace(frontmatterRegex, '').trim();

  const metadata: Partial<ArticleMetadata> = {};
  const frontmatterLines = frontmatterBlock.trim().split('\n');

  frontmatterLines.forEach((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return;

    const key = line.slice(0, colonIndex).trim();
    let valueStr = line.slice(colonIndex + 1).trim();
    let value: string | string[];

    // 配列の解析（categories, tagsなど）
    if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
      try {
        // シングルクォートをダブルクォートに変換してJSONパース
        value = JSON.parse(valueStr.replace(/'/g, '"'));
      } catch (e) {
        console.error(`Failed to parse array for key "${key}":`, valueStr);
        value = [] as string[];
      }
    } else {
      // クォート削除
      value = valueStr.replace(/^["'](.*)["']$/, '$1');
    }

    metadata[key as keyof ArticleMetadata] = value as any;
  });

  return { metadata, content };
}

/**
 * content/articles/ 配下の全MDXファイルを取得
 * @returns MDXファイルのパス配列
 */
export function getMDXFiles(dir: string = 'content/articles'): string[] {
  // apps/frontend/content/articles を参照
  const articlesDir = path.join(process.cwd(), dir);

  // ディレクトリが存在しない場合は空配列を返す
  if (!fs.existsSync(articlesDir)) {
    console.warn(`Directory not found: ${articlesDir}`);
    return [];
  }

  const files = fs.readdirSync(articlesDir);

  return files.filter((file) => path.extname(file) === '.md' || path.extname(file) === '.mdx');
}

/**
 * MDXファイルの内容を読み込む
 * @param slug ファイル名（拡張子なし）またはファイルパス
 * @param dir ディレクトリパス
 * @returns ファイル内容
 */
export function readMDXFile(slug: string, dir: string = 'content/articles'): string {
  // apps/frontend/content/articles を参照
  const articlesDir = path.join(process.cwd(), dir);

  // .md または .mdx 拡張子を試す
  const extensions = ['.md', '.mdx'];
  for (const ext of extensions) {
    const fullPath = path.join(articlesDir, `${slug}${ext}`);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8');
    }
  }

  throw new Error(`MDX file not found: ${slug}`);
}

/**
 * 全記事を取得（メタデータ付き）
 * @param dir ディレクトリパス
 * @returns Article配列（日付降順）
 */
export function getPosts(dir: string = 'content/articles'): Article[] {
  const mdxFiles = getMDXFiles(dir);

  const articles = mdxFiles.map((file) => {
    const slug = path.basename(file, path.extname(file));
    const rawContent = readMDXFile(slug, dir);
    const { metadata, content } = parseFrontmatter(rawContent);

    return {
      metadata: metadata as ArticleMetadata,
      slug,
      content
    };
  });

  // 日付降順でソート
  return articles.sort((a, b) => {
    return new Date(b.metadata.date).getTime() - new Date(a.metadata.date).getTime();
  });
}

/**
 * slugから特定の記事を取得
 * @param slug 記事のslug
 * @param dir ディレクトリパス
 * @returns Article
 */
export function getPostBySlug(slug: string, dir: string = 'content/articles'): Article | null {
  try {
    const rawContent = readMDXFile(slug, dir);
    const { metadata, content } = parseFrontmatter(rawContent);

    return {
      metadata: metadata as ArticleMetadata,
      slug,
      content
    };
  } catch (error) {
    console.error(`Failed to get post by slug "${slug}":`, error);
    return null;
  }
}

/**
 * カテゴリで記事をフィルタリング
 * @param category カテゴリ名
 * @param dir ディレクトリパス
 * @returns Article配列
 */
export function getPostsByCategory(category: string, dir: string = 'content/articles'): Article[] {
  const allPosts = getPosts(dir);
  return allPosts.filter((post) => post.metadata.categories?.includes(category));
}

/**
 * タグで記事をフィルタリング
 * @param tag タグ名
 * @param dir ディレクトリパス
 * @returns Article配列
 */
export function getPostsByTag(tag: string, dir: string = 'content/articles'): Article[] {
  const allPosts = getPosts(dir);
  return allPosts.filter((post) => post.metadata.tags?.includes(tag));
}

/**
 * 全カテゴリを取得
 * @param dir ディレクトリパス
 * @returns ユニークなカテゴリ配列
 */
export function getAllCategories(dir: string = 'content/articles'): string[] {
  const allPosts = getPosts(dir);
  const categories = allPosts.flatMap((post) => post.metadata.categories || []);
  return Array.from(new Set(categories)).sort();
}

/**
 * 全タグを取得
 * @param dir ディレクトリパス
 * @returns ユニークなタグ配列
 */
export function getAllTags(dir: string = 'content/articles'): string[] {
  const allPosts = getPosts(dir);
  const tags = allPosts.flatMap((post) => post.metadata.tags || []);
  return Array.from(new Set(tags)).sort();
}
