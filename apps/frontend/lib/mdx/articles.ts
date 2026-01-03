import fs from 'fs';
import path from 'path';

const FRONTEND_ROOT = path.join(process.cwd(), 'apps', 'frontend');

/**
 * モノレポルートを検出
 *
 * Next.jsの実行コンテキストに応じて、モノレポルートを適切に解決します。
 * - process.cwd() が apps/frontend の場合: ../../ がモノレポルート
 * - process.cwd() がモノレポルートの場合: そのまま使用
 */
function getMonorepoRoot(): string {
  const cwd = process.cwd();

  // process.cwd() が apps/frontend の場合（通常のNext.js実行時）
  if (cwd.endsWith(path.join('apps', 'frontend'))) {
    return path.join(cwd, '..', '..');
  }

  // process.cwd() がモノレポルートの場合（ビルド時など）
  return cwd;
}

function resolvePathRelativeToFrontend(relativePath: string): string | null {
  const MONOREPO_ROOT = getMonorepoRoot();

  const candidates = [
    path.join(FRONTEND_ROOT, relativePath),
    path.join(process.cwd(), relativePath),
    path.join(MONOREPO_ROOT, relativePath),  // モノレポルートからの参照を追加
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

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
  eventType: string | null;
  workSlug: string | null;
}

/**
 * 記事インデックスJSONを読み込む
 *
 * パフォーマンス最適化: 全ファイル読み込みではなくインデックスから取得
 *
 * Note: Turbopackの静的解析警告を回避するため、固定パスを使用
 */
export function getArticleIndex(): ArticleIndex {
  const MONOREPO_ROOT = getMonorepoRoot();

  // 固定パス: apps/frontend/lib/mdx/article-index.json
  const indexPath = path.join(
    MONOREPO_ROOT,
    'apps',
    'frontend',
    'lib',
    'mdx',
    'article-index.json'
  );

  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `article-index.json not found at ${indexPath}. Please run \`pnpm --filter @revolution/frontend generate:article-index\` before building.`
    );
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
export function getAllArticles(limit?: number, offset = 0): ArticleIndexItem[] {
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
  return index.articles.filter(article => article.categories.includes(category));
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

/**
 * 記事のURLパスを生成
 *
 * URL設計: /{event_type}/{work_slug}/{slug}
 * 例: /collabo-cafe/sample-work/01kafsdmvd
 *
 * レガシー記事（eventType='articles', workSlug=null）の場合:
 * 例: /articles/hello-mdx
 */
export function getArticleUrl(article: ArticleIndexItem): string {
  if (!article.event_type) {
    return `/articles/${article.slug}`;
  }

  if (article.event_type === 'articles' || !article.work_slug) {
    return `/articles/${article.slug}`;
  }

  return `/${article.event_type}/${article.work_slug}/${article.slug}`;
}

/**
 * パスパラメータから記事を検索
 *
 * @param eventType イベント種別 (collabo-cafe, pop-up-store, etc.)
 * @param workSlug 作品スラッグ (sample-work, chainsaw-man, etc.)
 * @param slug 記事スラッグ (01kafsdmvd, etc.)
 */
export function getArticleByPath(
  eventType: string,
  workSlug: string,
  slug: string
): ArticleIndexItem | null {
  const index = getArticleIndex();
  return (
    index.articles.find(
      article =>
        article.event_type === eventType && article.work_slug === workSlug && article.slug === slug
    ) || null
  );
}

export function readArticleContentFile(filePath: string): string {
  const resolvedPath = resolvePathRelativeToFrontend(filePath);

  if (!resolvedPath) {
    throw new Error(`Article file not found for path: ${filePath}`);
  }

  return fs.readFileSync(resolvedPath, 'utf-8');
}
