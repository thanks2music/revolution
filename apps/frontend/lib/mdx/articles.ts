import fs from 'fs';
import path from 'path';
import { ArticleMetadata } from './utils';

/**
 * 記事インデックスの型定義
 */
export interface ArticleIndex {
  generatedAt: string;
  totalArticles: number;
  articles: ArticleIndexItem[];
}

export interface ArticleIndexItem {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  author: string;
  filePath: string;
  ogImage?: string;
}

/**
 * 記事インデックスJSONを読み込む
 *
 * パフォーマンス最適化: 全ファイル読み込みではなくインデックスから取得
 */
export function getArticleIndex(): ArticleIndex {
  const indexPath = path.join(process.cwd(), 'lib', 'mdx', 'article-index.json');

  if (!fs.existsSync(indexPath)) {
    console.warn('Article index not found. Run `node scripts/generate-article-index.mjs`');
    return {
      generatedAt: new Date().toISOString(),
      totalArticles: 0,
      articles: [],
    };
  }

  const indexData = fs.readFileSync(indexPath, 'utf-8');
  return JSON.parse(indexData) as ArticleIndex;
}

/**
 * 全記事のメタデータを取得（インデックスベース）
 *
 * @param limit 取得件数上限（オプション）
 * @param offset 開始位置（ページネーション用）
 * @returns 記事メタデータ配列
 */
export function getAllArticles(
  limit?: number,
  offset = 0
): ArticleIndexItem[] {
  const index = getArticleIndex();
  const articles = index.articles;

  if (limit) {
    return articles.slice(offset, offset + limit);
  }

  return articles.slice(offset);
}

/**
 * カテゴリで記事をフィルタリング
 */
export function getArticlesByCategory(category: string): ArticleIndexItem[] {
  const index = getArticleIndex();
  return index.articles.filter(article =>
    article.categories.includes(category)
  );
}

/**
 * タグで記事をフィルタリング
 */
export function getArticlesByTag(tag: string): ArticleIndexItem[] {
  const index = getArticleIndex();
  return index.articles.filter(article => article.tags.includes(tag));
}

/**
 * 全カテゴリを取得
 */
export function getAllCategories(): string[] {
  const index = getArticleIndex();
  const categories = index.articles.flatMap(article => article.categories);
  return Array.from(new Set(categories)).sort();
}

/**
 * 全タグを取得
 */
export function getAllTags(): string[] {
  const index = getArticleIndex();
  const tags = index.articles.flatMap(article => article.tags);
  return Array.from(new Set(tags)).sort();
}

/**
 * slugで記事を検索
 */
export function getArticleBySlug(slug: string): ArticleIndexItem | null {
  const index = getArticleIndex();
  return index.articles.find(article => article.slug === slug) || null;
}

/**
 * 最新記事を取得
 */
export function getLatestArticles(limit = 10): ArticleIndexItem[] {
  const index = getArticleIndex();
  return index.articles.slice(0, limit);
}
