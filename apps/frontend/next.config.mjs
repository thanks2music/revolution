/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Next.js 公式推奨: shared/schemas/ workspace の .ts ファイルを直接 transpile する
  transpilePackages: ['@revolution/schemas'],

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

    // CSP connect-src 用に Supabase オリジンを env から動的抽出。
    // Crescendolls 会員機能（Auth / PostgREST / Realtime）のブラウザ実リクエストが
    // CSP でブロックされないために必須。
    //
    // - ハードコードした本番 ref のフォールバックは持たない（env が真実源）。
    // - CI build は SKIP_ENV_VALIDATION=true かつ Supabase env 未設定で走るため、
    //   env 未設定時は Supabase 由来の CSP エントリを安全に省略する
    //   （new URL(undefined) でクラッシュさせない = Build Apps を落とさない）。
    // - URL の不正値（解析失敗）も握りつぶして省略し、ヘッダ生成を止めない。
    let supabaseOrigin = '';
    let supabaseWsOrigin = '';
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
        supabaseOrigin = supabaseUrl.origin;
        // Realtime は WebSocket で接続するため WS オリジンも許可する。
        // protocol を https:→wss: / http:→ws: に切り替える（new URL の
        // protocol setter は origin を安全に再計算する）。local の
        // http://127.0.0.1:54321 でも ws://127.0.0.1:54321 が CSP に入る。
        const wsUrl = new URL(supabaseUrl.href);
        wsUrl.protocol = supabaseUrl.protocol === 'http:' ? 'ws:' : 'wss:';
        supabaseWsOrigin = wsUrl.origin;
      } catch {
        // URL 不正時は Supabase エントリを省略（ヘッダ生成は継続）。
        supabaseOrigin = '';
        supabaseWsOrigin = '';
      }
    }
    const connectSrc = [
      "'self'",
      wpOrigin,
      supabaseOrigin,
      supabaseWsOrigin,
    ]
      .filter(Boolean)
      .join(' ');

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
              `connect-src ${connectSrc}`,
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
