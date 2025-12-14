/**
 * Sitemap Generation
 * Next.js 14 App Router の sitemap 規約に従った実装
 */

import { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { getAllArticles, getArticleUrl } from '@/lib/mdx/articles';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_WP_URL || 'https://example.com';

  // 静的ページ
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];

  try {
    const articles = getAllArticles();

    const articlePages: MetadataRoute.Sitemap = articles.map((article) => ({
      url: `${baseUrl}${getArticleUrl(article)}`,
      lastModified: article.date ? new Date(article.date) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...articlePages];
  } catch (error) {
    console.error('サイトマップ生成エラー:', error);
    return staticPages;
  }
}
