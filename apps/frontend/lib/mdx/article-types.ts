/**
 * Client-safe article type definitions.
 *
 * Split out from `articles.ts` so Client Components can `import type` (and
 * runtime-import `getArticleUrl` from `./article-url`) without dragging the
 * `fs`/`path` dependencies of `articles.ts` into the client bundle.
 */

import type { EventData } from '@revolution/schemas/mdx-frontmatter';

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

  // ↓ Sprint C-α で新設: 開催ブロック event_data。
  // Templates 側 `2-extraction.yaml` の output.schema.properties.event_data に
  // 対応する canonical slug + occurrences[] 構造。MDX frontmatter に nested YAML
  // として serialize され、`generate-article-index.ts` で本 index に伝搬される。
  // **会場が N 個なら occurrences も N 要素**。
  //
  // DB upsert 本実装は **S3 (occurrence 半自動パイプライン = A-4)**。
  // EventFactCard は 4 フィールド (上記) を使用するのが基本で、
  // `event_data.occurrences[].venue_slug` を使った会場ページへの導線は S2 以降。
  event_data?: EventData;
}
