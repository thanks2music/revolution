/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * 画像最適化設定
   * - AVIF/WebP形式をサポート
   * - リモート画像ホストの許可リスト
   * - デバイスサイズとキャッシュ設定
   */
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60, // 60秒（ISRと整合）
    qualities: [75], // Next.js 16 デフォルト設定
    remotePatterns: [
      // 開発環境: HTTPを許可（localhostのみ）
      ...(process.env.NODE_ENV === 'development'
        ? [{ protocol: 'http', hostname: process.env.NEXT_PUBLIC_ALLOWED_IMAGE_HOST ?? 'localhost' }]
        : []),
      // 本番環境: HTTPSのみ
      { protocol: 'https', hostname: process.env.NEXT_PUBLIC_ALLOWED_IMAGE_HOST ?? 'localhost' },
      // Google Cloud Storage画像用の設定（pathname制約あり）
      ...(process.env.NEXT_PUBLIC_GCS_IMAGE_HOST
        ? [{
            protocol: 'https',
            hostname: process.env.NEXT_PUBLIC_GCS_IMAGE_HOST,
            pathname: process.env.NEXT_PUBLIC_GCS_BUCKET
              ? `/${process.env.NEXT_PUBLIC_GCS_BUCKET}/**`
              : '/**',
          }]
        : []),
      // Cloudflare R2画像用の設定（ogImage等）
      {
        protocol: 'https',
        hostname: 'images.anime-events.com',
      },
    ],
  },

  /**
   * リダイレクト設定
   * - WordPress互換パスからMDX記事パスへリダイレクト
   */
  async redirects() {
    return [
      {
        source: '/post/:slug',
        destination: '/articles/:slug',
        permanent: true, // 301リダイレクト（SEO考慮）
      },
      {
        source: '/category/:slug',
        destination: '/articles', // カテゴリページは記事一覧へ
        permanent: true,
      },
    ];
  },

  /**
   * セキュリティヘッダーの設定
   * - CSP (Content Security Policy)
   * - HSTS (HTTP Strict Transport Security)
   * - X-Frame-Options, X-Content-Type-Options等
   */
  async headers() {
    // CSP用にWordPressエンドポイントのオリジンを抽出
    const wpOrigin = process.env.NEXT_PUBLIC_WP_ENDPOINT
      ? new URL(process.env.NEXT_PUBLIC_WP_ENDPOINT).origin
      : '';

    return [
      {
        source: '/:path*',
        headers: [
          // Content Security Policy
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.jsの実行に必要
              "style-src 'self' 'unsafe-inline'", // Tailwind CSSに必要
              `img-src 'self' data: https: ${process.env.NEXT_PUBLIC_ALLOWED_IMAGE_HOST || 'localhost'}`,
              "font-src 'self' data:",
              "connect-src 'self'" + (wpOrigin ? ' ' + wpOrigin : ''),
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          // HTTP Strict Transport Security (本番環境のみ)
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains; preload',
                },
              ]
            : []),
          // X-Frame-Options (クリックジャッキング対策)
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // X-Content-Type-Options (MIMEタイプスニッフィング対策)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Referrer Policy
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Permissions Policy
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
