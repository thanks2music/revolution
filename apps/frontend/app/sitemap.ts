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
 * ## 🔴 種別ごとに独立して劣化させる (2026-08-14、レビュー指摘で是正)
 *
 * 以前は記事と DB 由来ページを**同じ try/catch で囲んでいた**。
 * `listEventParams` / `listOccurrenceParams` は DB エラーで throw する設計
 * (`lib/supabase/paginate.ts`) なので、Supabase の一時障害が起きると
 * **取得済みの記事一覧まで sitemap から丸ごと消えていた**。
 *
 * 「開催・企画の取得に失敗しても記事の sitemap は残す」という意図をコメントに
 * 書きながら、実装がそうなっていなかった。種別ごとに try/catch を分け、
 * 片方の失敗がもう片方を巻き込まない形にする。
 *
 * ⚠️ 資格情報を持たないビルド (CI) では列挙関数が 0 件を返すため、
 *    sitemap から開催・企画が消える。CI は sitemap の中身を検証しないので
 *    実害はないが、**「本番で 0 件」と「CI で 0 件」は原因が別**である点に注意
 *    (`lib/supabase/public.ts` の `hasPublicSupabaseCredentials` 参照)。
 */

import { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';
import { listEventParams } from '@/lib/event/queries';
import { getAllArticles, getArticleUrl } from '@/lib/mdx/articles';
import { listOccurrenceParams } from '@/lib/occurrence/queries';

/**
 * 記事ページ (fs 由来)。
 *
 * 失敗しても DB 由来のページは返せるよう、ここで閉じて空配列に倒す。
 */
function buildArticlePages(baseUrl: string): MetadataRoute.Sitemap {
  try {
    return getAllArticles().map((article) => ({
      url: `${baseUrl}${getArticleUrl(article)}`,
      lastModified: article.date ? new Date(article.date) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
  } catch (error) {
    // 黙って 0 件にしない。sitemap から記事が消えるのは SEO 上の事故。
    console.error('サイトマップ生成エラー (記事):', error);
    return [];
  }
}

/**
 * 企画・開催ページ (DB 由来)。
 *
 * 失敗しても記事の sitemap は返せるよう、ここで閉じて空配列に倒す。
 */
async function buildDatabasePages(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    // 企画は開催の列挙から導出される (`lib/event/queries.ts` の `listEventParams`)。
    const [eventParams, occurrenceParams] = await Promise.all([
      listEventParams(),
      listOccurrenceParams(),
    ]);

    return [
      ...eventParams.map((param) => ({
        url: `${baseUrl}${getEventUrl(param.id)}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        // 企画は開催をまとめる回遊のハブなので記事より少し高く置く。
        priority: 0.9,
      })),
      ...occurrenceParams.map((param) => ({
        url: `${baseUrl}${getOccurrenceUrl(param.id, param.occurrence_slug)}`,
        lastModified: new Date(),
        // 状態 (開催中 / 終了) が日付で変わるので、記事より更新頻度を高く申告する。
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ];
  } catch (error) {
    console.error('サイトマップ生成エラー (企画・開催):', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_WP_URL || 'https://example.com';

  // 静的ページ。取得に失敗する余地が無いので try/catch を持たない。
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];

  return [...staticPages, ...buildArticlePages(baseUrl), ...(await buildDatabasePages(baseUrl))];
}
