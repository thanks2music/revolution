/**
 * Client-safe article type definitions.
 *
 * Split out from `articles.ts` so Client Components can `import type` (and
 * runtime-import `getArticleUrl` from `./article-url`) without dragging the
 * `fs`/`path` dependencies of `articles.ts` into the client bundle.
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
  event_type: string | null;
  work_slug: string | null;

  event_title?: string;
  work_title?: string;
  prefectures?: string[];

  // ↓ FactCard の「あと N 日」黄色バッジを点灯させるために engineering/data の
  // データ拡張を待つ optional フィールド群。値が入ると EventFactCard が自動で
  // status='coming-soon' / 'now' / 'ended' のいずれかに切り替わる。
  event_start_date?: string;
  event_end_date?: string;
  venue?: string;
  official_url?: string;
}
