/**
 * Sitemap Generation
 * Next.js 14 App Router の sitemap 規約に従った実装
 *
 * ## 記事以外のコンテンツも載せる (2026-08-14 追加、PR #303 レビュー指摘)
 *
 * S2 で追加した開催・企画ページが sitemap から漏れていた。SEO が主要な流入
 * 経路である以上、**ページ種別を増やしたら sitemap にも足す**必要がある。
 * `generateStaticParams` と同じ列挙関数を使い回すことで、片方だけ増える状態を防ぐ。
 *
 * ⚠️ 資格情報を持たないビルド (CI) では列挙関数が 0 件を返すため、
 *    sitemap から開催・企画が消える。CI は sitemap の中身を検証しないので
 *    実害はないが、**「本番で 0 件」と「CI で 0 件」は原因が別**である点に注意
 *    (`lib/supabase/public.ts` の `hasPublicSupabaseCredentials` 参照)。
 */

import { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { listEventParams } from '@/lib/event/queries';
import { getAllArticles, getArticleUrl } from '@/lib/mdx/articles';
import { listOccurrenceParams } from '@/lib/occurrence/queries';

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

    // 開催・企画は DB 由来。取得に失敗しても記事の sitemap は返せるよう、
    // 既存の try/catch の内側で並行に取る。
    const [eventParams, occurrenceParams] = await Promise.all([
      listEventParams(),
      listOccurrenceParams(),
    ]);

    const eventPages: MetadataRoute.Sitemap = eventParams.map((param) => ({
      url: `${baseUrl}/events/${param.id}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      // 企画は開催をまとめる回遊のハブなので記事より少し高く置く。
      priority: 0.9,
    }));

    const occurrencePages: MetadataRoute.Sitemap = occurrenceParams.map((param) => ({
      url: `${baseUrl}/events/${param.id}/${param.occurrence_slug}`,
      lastModified: new Date(),
      // 状態 (開催中 / 終了) が日付で変わるので、記事より更新頻度を高く申告する。
      changeFrequency: 'daily' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...articlePages, ...eventPages, ...occurrencePages];
  } catch (error) {
    console.error('サイトマップ生成エラー:', error);
    return staticPages;
  }
}
