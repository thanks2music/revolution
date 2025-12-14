/**
 * 記事画像アップロードテストスクリプト
 *
 * 使用方法:
 *   pnpm tsx scripts/test-article-image-upload.ts [--dry-run] [--url <page_url>]
 *
 * オプション:
 *   --dry-run    実際にはアップロードせず、処理フローのみ確認
 *   --url        テスト対象のページURL
 *
 * 例:
 *   pnpm tsx scripts/test-article-image-upload.ts --dry-run
 *   pnpm tsx scripts/test-article-image-upload.ts --url https://example.com/collab
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

import { getArticleImageUploadService } from '../lib/services/article-image-upload.service';

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

// サンプルページURL
const DEFAULT_TEST_URL = 'https://cafe.animate.co.jp/event/';

async function main() {
  const { dryRun, url } = parseArgs();

  console.log('🖼️ 記事画像アップロードテスト開始\n');
  console.log('='.repeat(60));
  console.log(`モード: ${dryRun ? 'DRY RUN（実際にはアップロードしない）' : '本番（R2にアップロード）'}`);
  console.log('='.repeat(60));

  const service = getArticleImageUploadService();
  const testUrl = url || DEFAULT_TEST_URL;

  // テスト1: ページURLから画像を抽出してアップロード
  console.log('\n📋 テスト1: ページURLから画像を抽出してアップロード');
  console.log('-'.repeat(40));
  console.log(`テストURL: ${testUrl}`);

  try {
    // ページのHTMLを取得
    console.log('\nHTMLを取得中...');
    const response = await fetch(testUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RevolutionBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`ページ取得失敗: ${response.status}`);
    }

    const html = await response.text();
    console.log(`HTML取得完了: ${html.length} bytes`);

    // 画像をアップロード
    const result = await service.uploadFromHtml(html, testUrl, {
      articleSlug: `test-article-${Date.now()}`,
      eventType: 'test',
      year: new Date().getFullYear(),
      dryRun,
      uploadOgImage: true,
      uploadBodyImages: true,
    });

    console.log('\n📊 結果:');
    console.log(JSON.stringify({
      ogImage: result.ogImage,
      bodyImagesCount: result.bodyImages.length,
      stats: result.stats,
    }, null, 2));

    // 本文画像の詳細（最初の5件のみ）
    if (result.bodyImages.length > 0) {
      console.log('\n📷 本文画像（最初の5件）:');
      result.bodyImages.slice(0, 5).forEach((img, i) => {
        console.log(`  ${i + 1}. ${img.success ? '✅' : '❌'} ${img.originalUrl.substring(0, 60)}...`);
        if (img.r2Url) {
          console.log(`     → ${img.r2Url}`);
        }
      });
      if (result.bodyImages.length > 5) {
        console.log(`  ... 他 ${result.bodyImages.length - 5} 件`);
      }
    }

    console.log('\n✅ テスト1完了');
  } catch (error) {
    console.error('❌ テスト1失敗:', error);
  }

  // テスト2: URL配列から直接アップロード
  console.log('\n📋 テスト2: URL配列から直接アップロード');
  console.log('-'.repeat(40));

  const testUrls = [
    'https://picsum.photos/800/600',
    'https://picsum.photos/1200/800',
  ];

  console.log(`テスト画像URL: ${testUrls.length}件`);

  try {
    const result = await service.uploadFromUrls(testUrls, {
      articleSlug: `test-urls-${Date.now()}`,
      eventType: 'test',
      year: new Date().getFullYear(),
      dryRun,
    });

    console.log('\n📊 結果:');
    console.log(JSON.stringify({
      bodyImagesCount: result.bodyImages.length,
      stats: result.stats,
    }, null, 2));

    result.bodyImages.forEach((img, i) => {
      console.log(`  ${i + 1}. ${img.success ? '✅' : '❌'} ${img.originalUrl}`);
      if (img.r2Url) {
        console.log(`     → ${img.r2Url}`);
      }
    });

    console.log('\n✅ テスト2完了');
  } catch (error) {
    console.error('❌ テスト2失敗:', error);
  }

  // テスト3: コンテンツ内のURL置換
  console.log('\n📋 テスト3: コンテンツ内のURL置換');
  console.log('-'.repeat(40));

  const testContent = `
# テスト記事

![画像1](https://picsum.photos/800/600)

本文テキスト

![画像2](https://picsum.photos/1200/800)

終わり
`;

  console.log('テストコンテンツ:');
  console.log(testContent);

  try {
    const result = await service.uploadFromUrls(
      ['https://picsum.photos/800/600', 'https://picsum.photos/1200/800'],
      {
        articleSlug: `test-transform-${Date.now()}`,
        eventType: 'test',
        year: new Date().getFullYear(),
        dryRun,
        content: testContent,
      }
    );

    console.log('\n📄 変換後のコンテンツ:');
    console.log(result.transformedContent);

    console.log('\n✅ テスト3完了');
  } catch (error) {
    console.error('❌ テスト3失敗:', error);
  }

  // 結果サマリー
  console.log('\n' + '='.repeat(60));
  console.log('📊 テスト完了');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('\n❌ 予期しないエラー:', error);
  process.exit(1);
});
