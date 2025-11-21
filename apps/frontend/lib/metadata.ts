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
  twitterHandle: '@your_twitter', // Twitter handle（必要に応じて環境変数化）
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
    keywords: ['Next.js', 'WordPress', 'Blog', 'Headless CMS', 'Revolution'],
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
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteConfig.url}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
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
