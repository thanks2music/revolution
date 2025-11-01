/**
 * Robots.txt Generation
 * Next.js 14 App Router の robots 規約に従った実装
 */

import { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = env.NEXT_PUBLIC_WP_URL || 'https://example.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',           // APIルートをクロール対象外
          '/_next/',         // Next.jsの内部ファイル
          '/admin/',         // 管理画面（存在する場合）
        ],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/api/', '/_next/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
