/**
 * Metadata Utility
 * SEO最適化のためのメタデータ生成ヘルパー
 */

import { Metadata } from 'next';
import { env } from './env';

/**
 * サイトの基本情報
 */
export const siteConfig = {
  name: env.NEXT_PUBLIC_SITE_NAME,
  description: env.NEXT_PUBLIC_SITE_DESCRIPTION,
  url: env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_WP_URL || 'https://example.com',
  ogImage: '/og-image.png', // デフォルトのOG画像
  twitterHandle: '@anime_events_X',
  xUrl: 'https://x.com/anime_events_X',
  instagramUrl: 'https://www.instagram.com/anime_events_com/',
};

/**
 * 基本メタデータを生成
 */
export function generateBasicMetadata(): Metadata {
  return {
    metadataBase: new URL(siteConfig.url),
    title: {
      default: siteConfig.name,
      template: `%s | ${siteConfig.name}`,
    },
    description: siteConfig.description,
    keywords: ['コラボカフェ', 'ポップアップストア', 'アニメイベント', '推し活', 'コラボイベント'],
    authors: [{ name: siteConfig.name }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    openGraph: {
      type: 'website',
      locale: 'ja_JP',
      url: siteConfig.url,
      siteName: siteConfig.name,
      title: siteConfig.name,
      description: siteConfig.description,
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      site: siteConfig.twitterHandle,
      creator: siteConfig.twitterHandle,
      title: siteConfig.name,
      description: siteConfig.description,
      images: [siteConfig.ogImage],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    verification: {
      // Google Search Console検証用（必要に応じて環境変数化）
      // google: 'your-google-verification-code',
    },
  };
}

/**
 * 記事ページのメタデータを生成
 */
export function generateArticleMetadata({
  title,
  description,
  publishedTime,
  modifiedTime,
  authors,
  tags,
  imageUrl,
  slug,
  path,
}: {
  title: string;
  description: string;
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
  tags?: string[];
  imageUrl?: string;
  slug: string;
  path?: string;
}): Metadata {
  const canonicalPath = path ?? `/articles/${slug}`;
  const url = `${siteConfig.url}${canonicalPath}`;
  const ogImage = imageUrl || siteConfig.ogImage;

  return {
    title,
    description,
    keywords: tags,
    authors: authors?.map((name) => ({ name })),
    openGraph: {
      type: 'article',
      locale: 'ja_JP',
      url,
      siteName: siteConfig.name,
      title,
      description,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      publishedTime,
      modifiedTime,
      authors,
      tags,
    },
    twitter: {
      card: 'summary_large_image',
      site: siteConfig.twitterHandle,
      creator: siteConfig.twitterHandle,
      title,
      description,
      images: [ogImage],
    },
  };
}

/**
 * 記事以外のコンテンツページ (開催 / 企画 / 作品 / 会場) のメタデータを生成。
 *
 * ## なぜ専用の関数を足したか (PR #303 レビュー指摘)
 *
 * 既存の記事 / カテゴリページは本モジュール経由で openGraph / twitter /
 * canonical (`og:url`) を出しているのに、S2 で新設したページは
 * `title` + `description` しか返しておらず、**OG 画像も canonical も無い**状態だった。
 * SEO が主要な流入経路である以上、ページ種別が増えるたびに素の `Metadata` を
 * 手書きすると、こうした欠落が静かに増える。
 *
 * `generateArticleMetadata` を流用しないのは `og:type` が `article` 固定で、
 * 開催・企画は記事ではないため (`website` が妥当)。
 *
 * @param path - canonical パス。**先頭スラッシュ付きの絶対パス**を渡す
 */
export function generateContentMetadata({
  title,
  description,
  path,
  imageUrl,
}: {
  title: string;
  description: string;
  path: string;
  imageUrl?: string;
}): Metadata {
  const url = `${siteConfig.url}${path}`;
  const ogImage = imageUrl || siteConfig.ogImage;

  return {
    title,
    description,
    alternates: { canonical: url },
    /*
     * 🔴 **S2 ルート群は暫定的に noindex** (BOSS 確定 2026-08-25)。
     *
     * production Supabase へデータを投入するが、**A-1-b (記事品質ゲート) が未達**の
     * まま公開すると、名寄せ修正で `occurrences.slug` が変わったときに
     * **インデックス済み URL が死ぬ**。データは入れつつ、**公開 URL の確定だけ遅らせる**。
     *
     * - `follow: true` は残す — 回遊は辿らせたいため
     * - `robots.txt` の disallow は**使わない**。クロール自体を止めると解除しても
     *   再発見が遅れる。noindex メタタグならクロールは続き、解除が速く反映される
     *
     * ## 対象がここで過不足なく決まる理由
     *
     * 本関数の呼び出し元は **S2 の 10 ルートのみ** (`/titles` `/events` `/venues` と
     * それぞれの配下)。記事詳細は `generateArticleMetadata` を使うため**影響しない**。
     * よって 1 箇所で正しい範囲を覆える。
     *
     * ## 🔴 解除条件
     *
     * **A-1-b (記事品質ゲート) 合格** が公開のスイッチ。解除時は本ブロックを削除し、
     * `app/sitemap.ts` の `INCLUDE_S2_ROUTES` も `true` へ戻すこと (セットで必要)。
     */
    robots: { index: false, follow: true },
    openGraph: {
      type: 'website',
      locale: 'ja_JP',
      url,
      siteName: siteConfig.name,
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      site: siteConfig.twitterHandle,
      creator: siteConfig.twitterHandle,
      title,
      description,
      images: [ogImage],
    },
  };
}

/**
 * カテゴリページのメタデータを生成
 */
export function generateCategoryMetadata({
  categoryName,
  description,
  slug,
}: {
  categoryName: string;
  description?: string;
  slug: string;
}): Metadata {
  const title = `${categoryName}カテゴリの記事一覧`;
  const desc = description || `${categoryName}に関する記事の一覧ページです。`;
  const url = `${siteConfig.url}/category/${slug}`;

  return {
    title,
    description: desc,
    openGraph: {
      type: 'website',
      locale: 'ja_JP',
      url,
      siteName: siteConfig.name,
      title,
      description: desc,
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      site: siteConfig.twitterHandle,
      creator: siteConfig.twitterHandle,
      title,
      description: desc,
      images: [siteConfig.ogImage],
    },
  };
}

/**
 * JSON-LD構造化データ: WebSite
 */
export function generateWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    // SNS プロフィールとサイトのエンティティを紐付ける (schema.org 標準)
    sameAs: [siteConfig.xUrl, siteConfig.instagramUrl],
    // NOTE: SearchAction は意図的に持たない。/search ルートが存在しないため、
    // 宣言すると構造化データが実在しないエンドポイントを主張することになる。
    // 検索機能 (mvp-definition.md C-1-a) の実装時に追加する。
  };
}

/**
 * JSON-LD構造化データ: Article
 */
export function generateArticleSchema({
  title,
  description,
  publishedTime,
  modifiedTime,
  imageUrl,
  authorName,
  slug,
}: {
  title: string;
  description: string;
  publishedTime: string;
  modifiedTime?: string;
  imageUrl?: string;
  authorName?: string;
  slug: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    image: imageUrl || siteConfig.ogImage,
    datePublished: publishedTime,
    dateModified: modifiedTime || publishedTime,
    author: {
      '@type': 'Person',
      name: authorName || siteConfig.name,
    },
    publisher: {
      '@type': 'Organization',
      name: siteConfig.name,
      logo: {
        '@type': 'ImageObject',
        url: `${siteConfig.url}/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${siteConfig.url}/post/${slug}`,
    },
  };
}
