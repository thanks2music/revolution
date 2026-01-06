import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  images: {
    // v16 で変更されたデフォルト値を明示的に設定（現行動作を維持）
    minimumCacheTTL: 60, // Override Next.js 16 default (4 hours) to 60s for faster content updates
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384], // v16 でデフォルトから 16 が削除されたため明示
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    remotePatterns: [
      // Cloudflare R2 (production image hosting)
      {
        protocol: 'https',
        hostname: 'images.anime-events.com',
      },
    ],
  },
};

// Validate required Firebase environment variables at build time
// Skip validation in CI environment (dummy values are used for build-only testing)
const requiredEnvVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

if (process.env.NODE_ENV === 'production' && process.env.CI !== 'true') {
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required Firebase environment variables for production build: ${missing.join(', ')}. ` +
        `Please set these in your deployment environment.`
    );
  }
}

export default nextConfig;