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

import * as Sentry from '@sentry/nextjs';
import { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';
import { listEventParams } from '@/lib/event/queries';
import { getAllArticles, getArticleUrl } from '@/lib/mdx/articles';
import { listOccurrenceParams } from '@/lib/occurrence/queries';
import { listTitleParams } from '@/lib/title/queries';
import {
  getTitleArticlesUrl,
  getTitleOccurrencesUrl,
  getTitleUrl,
} from '@/lib/title/title-url';
import { listVenueParams } from '@/lib/venue/queries';
import { getVenueUrl } from '@/lib/venue/venue-url';

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
    Sentry.captureException(error, { tags: { sitemap: 'articles' } });
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
    Sentry.captureException(error, { tags: { sitemap: 'events' } });
    return [];
  }
}

/**
 * 作品ハブ + 集約ビュー (DB 由来)。
 *
 * 生成対象は `generateStaticParams` (`listTitleParams`) と同じ「titles マスタの
 * 全 slug」。カテゴリ絞り込み (`/titles/{slug}/articles/{category}`) は
 * **意図的に載せない** — 記事一覧の絞り込みビューで、載っている記事の canonical
 * は `/articles/{ULID}` にあるため、sitemap 上の発見経路としては記事一覧までで
 * 足りる (チップ経由でクロール可能)。
 */
async function buildTitlePages(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const titleParams = await listTitleParams();

    return titleParams.flatMap((param) => [
      {
        url: `${baseUrl}${getTitleUrl(param.slug)}`,
        lastModified: new Date(),
        // 開催の状態 (開催中 / 終了) が日付で変わるハブなので daily。
        changeFrequency: 'daily' as const,
        // 企画と同じく回遊のハブなので記事より少し高く置く。
        priority: 0.9,
      },
      {
        url: `${baseUrl}${getTitleArticlesUrl(param.slug)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      },
      {
        url: `${baseUrl}${getTitleOccurrencesUrl(param.slug)}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.6,
      },
    ]);
  } catch (error) {
    console.error('サイトマップ生成エラー (作品):', error);
    Sentry.captureException(error, { tags: { sitemap: 'titles' } });
    return [];
  }
}

/**
 * 会場ページ (DB 由来)。
 *
 * 生成対象は `generateStaticParams` (`listVenueParams`) と同じ「venues マスタの
 * 全 slug」。開催 0 件の会場も載せる (ページ自体は空状態で常に存在する)。
 */
async function buildVenuePages(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const venueParams = await listVenueParams();

    return venueParams.map((param) => ({
      url: `${baseUrl}${getVenueUrl(param.slug)}`,
      lastModified: new Date(),
      // 開催の状態 (開催中 / 終了) が日付で変わるので daily。
      changeFrequency: 'daily' as const,
      // 回遊ハブだが開催 0 件のページも多いので、作品・企画 (0.9) より下に置く。
      priority: 0.7,
    }));
  } catch (error) {
    console.error('サイトマップ生成エラー (会場):', error);
    Sentry.captureException(error, { tags: { sitemap: 'venues' } });
    return [];
  }
}

/**
 * S2 ルート群 (`/titles` `/events` `/venues` とその配下) を sitemap に載せるか。
 *
 * 🔴 **現在 `false`** — 同ルート群は暫定的に noindex にしている (BOSS 確定 2026-08-25、
 * 理由は `lib/metadata.ts` の `generateContentMetadata` を参照)。
 *
 * **noindex の URL を sitemap に載せるのは矛盾**で、Search Console が
 * 「送信された URL に noindex タグが追加されています」と警告を出す。載せない。
 *
 * ⚠️ `/articles` 系は**対象外** (既に公開・インデックス済みのため現状維持)。
 *
 * ## 🔴 解除時
 *
 * A-1-b (記事品質ゲート) 合格で noindex を外す際に **`true` へ戻す**。
 * `lib/metadata.ts` の `robots` ブロック削除とセットで行うこと。
 *
 * 併せて **`app/sitemap.ts` はビルド時固定** (`revalidate` 未指定 = 無期限キャッシュ、
 * build manifest で `initialRevalidateSeconds=false` を実測) である点に注意。
 * 解除後に新しい URL を載せ続けるには `export const revalidate` の追加が要る。
 *
 * 型注釈を付けているのは、リテラル型に絞られると分岐が dead code 扱いになるため。
 */
const INCLUDE_S2_ROUTES: boolean = false;

/**
 * S2 ルート群 (`/titles` `/events` `/venues` の配下) のエントリを列挙する。
 *
 * **`INCLUDE_S2_ROUTES` から切り離して export している**のは、noindex 期間中も
 * **列挙ロジック自体の回帰テストを生かし続ける**ため。ここが壊れていることに
 * 気づかないまま noindex を解除すると、PR #303 で直した「S2 ページが sitemap から
 * 黙って漏れる」バグが**そのまま再発**する。テストは本関数を直接叩く。
 */
export async function buildS2Pages(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  return [
    ...(await buildDatabasePages(baseUrl)),
    ...(await buildTitlePages(baseUrl)),
    ...(await buildVenuePages(baseUrl)),
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_WP_URL || 'https://example.com';

  // 静的ページ。取得に失敗する余地が無いので try/catch を持たない。
  // `/titles` / `/events` の一覧ページは中身が DB 由来でも**ページ自体は常に
  // 存在する** (0 件でも空状態を描く) のでここに置く。
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    ...(INCLUDE_S2_ROUTES
      ? ([
          {
            url: `${baseUrl}/titles`,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 0.8,
          },
          {
            url: `${baseUrl}/events`,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 0.8,
          },
          {
            url: `${baseUrl}/venues`,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 0.8,
          },
        ] satisfies MetadataRoute.Sitemap)
      : []),
  ];

  // 記事は常に載せる (noindex 対象外)。S2 ルート群はフラグで切り替える。
  const s2Pages = INCLUDE_S2_ROUTES ? await buildS2Pages(baseUrl) : [];

  return [...staticPages, ...buildArticlePages(baseUrl), ...s2Pages];
}
