/**
 * OG画像アップロードテストスクリプト
 *
 * 使用方法:
 *   pnpm tsx scripts/test-og-image-upload.ts [--dry-run] [--url <page_url>]
 *
 * オプション:
 *   --dry-run    実際にはアップロードせず、処理フローのみ確認
 *   --url        テスト対象のページURL（指定しない場合はサンプルURLを使用）
 *
 * 例:
 *   pnpm tsx scripts/test-og-image-upload.ts --dry-run
 *   pnpm tsx scripts/test-og-image-upload.ts --url https://example.com/collab
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

import { getOgImageUploadService } from '../lib/services/og-image-upload.service';

// コマンドライン引数をパース
function parseArgs(): { dryRun: boolean; url?: string } {
  const args = process.argv.slice(2);
  const result: { dryRun: boolean; url?: string } = { dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--url' && args[i + 1]) {
      result.url = args[i + 1];
      i++;
    }
  }

  return result;
}

// サンプルOG画像URL（テスト用）
const SAMPLE_OG_IMAGE_URLS = [
  // 一般的なテスト用画像
  'https://picsum.photos/1200/630',
  // Wikipedia のサンプル画像
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/1200px-Camponotus_flavomarginatus_ant.jpg',
];

// サンプルページURL（OGP画像を持つサイト）
const SAMPLE_PAGE_URLS = [
  'https://www.animate.co.jp/',
  'https://cafe.animate.co.jp/',
];

async function main() {
  const { dryRun, url } = parseArgs();

  console.log('🖼️ OG画像アップロードテスト開始\n');
  console.log('='.repeat(60));
  console.log(`モード: ${dryRun ? 'DRY RUN（実際にはアップロードしない）' : '本番（R2にアップロード）'}`);
  console.log('='.repeat(60));

  const ogService = getOgImageUploadService();

  // テスト1: URLから直接アップロード
  console.log('\n📋 テスト1: 画像URLから直接アップロード');
  console.log('-'.repeat(40));

  const testImageUrl = SAMPLE_OG_IMAGE_URLS[0];
  console.log(`テスト画像URL: ${testImageUrl}`);

  const result1 = await ogService.uploadFromUrl(testImageUrl, {
    folder: 'test/og-images',
    articleSlug: `test-${Date.now()}`,
    dryRun,
  });

  console.log('\n結果:');
  console.log(JSON.stringify(result1, null, 2));

  if (!result1.success) {
    console.error('❌ テスト1失敗');
  } else {
    console.log('✅ テスト1成功');
  }

  // テスト2: ページURLからOG画像を抽出してアップロード
  console.log('\n📋 テスト2: ページURLからOG画像を抽出してアップロード');
  console.log('-'.repeat(40));

  const testPageUrl = url || SAMPLE_PAGE_URLS[0];
  console.log(`テストページURL: ${testPageUrl}`);

  const result2 = await ogService.uploadFromPageUrl(testPageUrl, {
    folder: 'test/og-images',
    articleSlug: `page-test-${Date.now()}`,
    dryRun,
  });

  console.log('\n結果:');
  console.log(JSON.stringify(result2, null, 2));

  if (!result2.success) {
    console.error('❌ テスト2失敗:', result2.error);
  } else {
    console.log('✅ テスト2成功');
  }

  // テスト3: HTMLから抽出してアップロード（インラインHTML）
  console.log('\n📋 テスト3: HTMLコンテンツからOG画像を抽出');
  console.log('-'.repeat(40));

  const sampleHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta property="og:image" content="https://picsum.photos/1200/630" />
      <meta property="og:title" content="テストページ" />
    </head>
    <body>
      <h1>テストコンテンツ</h1>
    </body>
    </html>
  `;

  const result3 = await ogService.uploadFromHtml(
    sampleHtml,
    'https://example.com/',
    {
      folder: 'test/og-images',
      articleSlug: `html-test-${Date.now()}`,
      dryRun,
    }
  );

  console.log('\n結果:');
  console.log(JSON.stringify(result3, null, 2));

  if (!result3.success) {
    console.error('❌ テスト3失敗:', result3.error);
  } else {
    console.log('✅ テスト3成功');
  }

  // 結果サマリー
  console.log('\n' + '='.repeat(60));
  console.log('📊 テスト結果サマリー:');
  console.log(`  テスト1 (URL直接): ${result1.success ? '✅ 成功' : '❌ 失敗'}`);
  console.log(`  テスト2 (ページ抽出): ${result2.success ? '✅ 成功' : '❌ 失敗'}`);
  console.log(`  テスト3 (HTML抽出): ${result3.success ? '✅ 成功' : '❌ 失敗'}`);
  console.log('='.repeat(60));

  const allSuccess = result1.success && result2.success && result3.success;
  if (allSuccess) {
    console.log('\n🎉 全てのテストが成功しました！\n');
  } else {
    console.log('\n⚠️ 一部のテストが失敗しました。上記のエラーを確認してください。\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ 予期しないエラー:', error);
  process.exit(1);
});
