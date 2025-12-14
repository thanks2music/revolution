#!/usr/bin/env tsx
/**
 * 環境変数の検証スクリプト
 * Vercel デプロイ前に環境変数が正しく設定されているかチェック
 */

import { z } from 'zod';

// 環境変数のスキーマ定義
const envSchema = z.object({
  // 必須環境変数
  NEXT_PUBLIC_WP_ENDPOINT: z
    .string()
    .url('WordPress GraphQL エンドポイントは有効なURLである必要があります'),

  // 任意環境変数（デフォルト値あり）
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_WP_URL: z.string().url().optional(),
  NEXT_PUBLIC_ALLOWED_IMAGE_HOST: z.string().optional(),
  NEXT_PUBLIC_GCS_IMAGE_HOST: z.string().optional(),
  NEXT_PUBLIC_GCS_BUCKET: z.string().optional(),
  NEXT_PUBLIC_SITE_NAME: z.string().optional().default('Revolution'),
  NEXT_PUBLIC_SITE_DESCRIPTION: z.string().optional().default('Next.js + WordPress Headless CMS'),
  NEXT_PUBLIC_DEBUG: z
    .string()
    .optional()
    .transform(val => val === 'true'),
  NEXT_PUBLIC_SWR_REFRESH_INTERVAL: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 60000)),
  NEXT_PUBLIC_SWR_DEDUPING_INTERVAL: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 60000))
});

type Env = z.infer<typeof envSchema>;

/**
 * 環境変数を検証
 */
function validateEnv(): Env {
  console.log('🔍 環境変数を検証中...\n');

  try {
    const env = envSchema.parse(process.env);

    console.log('✅ 環境変数の検証に成功しました\n');
    console.log('📋 設定値:');
    console.log(`  NEXT_PUBLIC_WP_ENDPOINT: ${env.NEXT_PUBLIC_WP_ENDPOINT}`);
    console.log(`  NEXT_PUBLIC_SITE_URL: ${env.NEXT_PUBLIC_SITE_URL || '(未設定)'}`);
    console.log(`  NEXT_PUBLIC_WP_URL: ${env.NEXT_PUBLIC_WP_URL || '(未設定)'}`);
    console.log(
      `  NEXT_PUBLIC_ALLOWED_IMAGE_HOST: ${env.NEXT_PUBLIC_ALLOWED_IMAGE_HOST || '(未設定)'}`
    );
    console.log(`  NEXT_PUBLIC_GCS_IMAGE_HOST: ${env.NEXT_PUBLIC_GCS_IMAGE_HOST || '(未設定)'}`);
    console.log(`  NEXT_PUBLIC_GCS_BUCKET: ${env.NEXT_PUBLIC_GCS_BUCKET || '(未設定)'}`);
    console.log(`  NEXT_PUBLIC_SITE_NAME: ${env.NEXT_PUBLIC_SITE_NAME}`);
    console.log(`  NEXT_PUBLIC_SITE_DESCRIPTION: ${env.NEXT_PUBLIC_SITE_DESCRIPTION}`);
    console.log(`  NEXT_PUBLIC_DEBUG: ${env.NEXT_PUBLIC_DEBUG}`);
    console.log(`  NEXT_PUBLIC_SWR_REFRESH_INTERVAL: ${env.NEXT_PUBLIC_SWR_REFRESH_INTERVAL}ms`);
    console.log(
      `  NEXT_PUBLIC_SWR_DEDUPING_INTERVAL: ${env.NEXT_PUBLIC_SWR_DEDUPING_INTERVAL}ms\n`
    );

    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ 環境変数の検証に失敗しました\n');
      console.error('エラー詳細:');
      error.issues.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      console.error(
        '\n📚 dotfiles/08-cicd/ディレクトリ内のドキュメントを参照して、必要な環境変数を設定してください\n'
      );
      process.exit(1);
    }
    throw error;
  }
}

/**
 * WordPress GraphQL エンドポイントの接続テスト
 */
async function testWordPressConnection(endpoint: string): Promise<void> {
  console.log('🔌 WordPress GraphQL エンドポイントへの接続をテスト中...\n');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: '{ generalSettings { title url } }'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(JSON.stringify(data.errors, null, 2));
    }

    console.log('✅ WordPress への接続に成功しました');
    console.log(
      `  サイトタイトル: ${data.data?.generalSettings?.title || '(取得できませんでした)'}`
    );
    console.log(`  サイトURL: ${data.data?.generalSettings?.url || '(取得できませんでした)'}\n`);
  } catch (error) {
    console.error('❌ WordPress への接続に失敗しました');
    console.error(`  エンドポイント: ${endpoint}`);
    console.error(`  エラー: ${error instanceof Error ? error.message : String(error)}\n`);
    console.warn(
      '⚠️  WordPress が起動していない、またはエンドポイントが正しくない可能性があります\n'
    );
    // 接続失敗は警告のみで、検証は続行
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('='.repeat(60));
  console.log('  Revolution Frontend - 環境変数検証');
  console.log('='.repeat(60));
  console.log('');

  const env = validateEnv();

  // WordPress 接続テスト（任意）
  if (process.argv.includes('--test-connection')) {
    await testWordPressConnection(env.NEXT_PUBLIC_WP_ENDPOINT);
  }

  console.log('✅ すべての検証が完了しました');
  console.log('');
}

main().catch(error => {
  console.error('予期しないエラーが発生しました:', error);
  process.exit(1);
});
