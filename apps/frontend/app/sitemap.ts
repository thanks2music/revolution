/**
 * Sitemap Generation
 * Next.js 14 App Router の sitemap 規約に従った実装
 */

import { MetadataRoute } from 'next';
import PostService from '@/services/PostService';
import { env } from '@/lib/env';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.NEXT_PUBLIC_WP_URL || 'https://example.com';

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
    // 全記事を取得
    const posts = await PostService.getList({});

    // 記事ページのサイトマップエントリー
    const postPages: MetadataRoute.Sitemap = posts.map((post) => ({
      url: `${baseUrl}/post/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    // すべてのページを結合
    return [...staticPages, ...postPages];
  } catch (error) {
    console.error('サイトマップ生成エラー:', error);
    // エラー時は静的ページのみ返す
    return staticPages;
  }
}
