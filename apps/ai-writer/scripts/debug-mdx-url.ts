/**
 * URLから直接MDX記事を生成するデバッグスクリプト
 *
 * 既存の debug-mdx-generation.ts と同じパターンで実装:
 * - API Route経由ではなく、直接サービスクラスを呼び出し
 * - 認証不要（.env.local から環境変数を読み込み）
 * - Next.js起動不要（高速実行）
 *
 * 使用方法:
 *   pnpm debug:mdx https://animeanime.jp/article/2025/11/24/94010.html
 *
 * 前提条件:
 *   - .env.local に GITHUB_PAT を設定
 *   - .env.local に ANTHROPIC_API_KEY を設定
 *   - Firebase Admin SDK の認証情報を設定
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

// HTML + タイトル抽出
import { extractArticleData } from '../lib/utils/html-extractor';

// MDX生成サービス
import { ArticleGenerationMdxService } from '../lib/services/article-generation-mdx.service';
import type { MdxGenerationRequest } from '../lib/services/article-generation-mdx.service';

/**
 * メインデバッグフロー
 */
async function main() {
  // コマンドライン引数からURL取得
  const url = process.argv[2];

  if (!url) {
    console.error('\n❌ エラー: URLが指定されていません\n');
    console.log('使用方法:');
    console.log('  pnpm debug:mdx <URL>\n');
    console.log('例:');
    console.log('  pnpm debug:mdx https://animeanime.jp/article/2025/11/24/94010.html\n');
    process.exit(1);
  }

  console.log('🔍 URLからMDX記事生成デバッグ開始\n');
  console.log('='.repeat(80));
  console.log('URL指定デバッグモード');
  console.log('='.repeat(80));
  console.log(`URL: ${url}`);
  console.log();

  try {
    // ========================================
    // STEP 1: URLからタイトル + HTMLを抽出
    // ========================================
    console.log('📄 STEP 1: HTMLとタイトルを取得中...');

    const { title, html, actualUrl } = await extractArticleData(url);

    console.log(`✅ タイトル: ${title}`);
    console.log(`✅ HTML: ${html.length} bytes`);
    console.log(`✅ 実際のURL: ${actualUrl}`);
    console.log();

    // ========================================
    // STEP 2: MDX生成（全パイプライン実行）
    // ========================================
    console.log('🤖 STEP 2: MDX記事生成パイプライン実行中...');
    console.log('  → 記事選別（公式URL検出）');
    console.log('  → 作品/店舗/イベント情報抽出');
    console.log('  → Firestore重複チェック');
    console.log('  → カテゴリ/抜粋生成');
    console.log('  → タイトル生成');
    console.log('  → MDX記事生成');
    console.log('  → GitHub PR作成');
    console.log();

    const service = new ArticleGenerationMdxService();

    const request: MdxGenerationRequest = {
      rssItem: {
        title,
        link: actualUrl,
        content: html,
        contentSnippet: html.substring(0, 500), // 最初の500文字をスニペットとして使用
        pubDate: new Date().toISOString(),
      },
    };

    const result = await service.generateMdxFromRSS(request);

    // ========================================
    // STEP 3: 結果表示
    // ========================================
    console.log();
    console.log('='.repeat(80));
    console.log('📊 生成結果');
    console.log('='.repeat(80));

    if (result.skipped) {
      console.log('\n⚠️  記事生成をスキップしました');
      console.log(`理由: ${result.skipReason}`);
      console.log();
      console.log('='.repeat(80));
      console.log('💡 デバッグヒント:');
      console.log('  - 記事内に公式URLが含まれているか確認してください');
      console.log('  - YAML テンプレートの条件を確認してください');
      console.log('  - DEBUG_HTML_EXTRACTION=true で抽出HTMLを確認できます');
      console.log('='.repeat(80));
      process.exit(0);
    }

    if (!result.success) {
      console.error('\n❌ MDX記事の生成に失敗しました');
      console.error(`エラー: ${result.error}`);
      console.log();
      process.exit(1);
    }

    console.log('\n✅ MDX記事生成成功！');
    console.log();

    if (result.mdxArticle) {
      console.log('📝 記事情報:');
      console.log(`  タイトル: ${result.mdxArticle.title || title}`);
      console.log(`  ファイルパス: ${result.mdxArticle.filePath}`);
      console.log(`  ファイルサイズ: ${result.mdxArticle.content?.length || 0}文字`);
      console.log();
    }

    if (result.prResult) {
      console.log('🔀 GitHub PR:');
      console.log(`  PR番号: #${result.prResult.prNumber}`);
      console.log(`  PR URL: ${result.prResult.prUrl}`);
      console.log(`  ブランチ: ${result.prResult.branchName}`);
      console.log(`  コミットSHA: ${result.prResult.commitSha}`);
      console.log();
    }

    if (result.details) {
      console.log('🏷️  メタデータ:');
      console.log(`  作品スラッグ: ${result.details.workSlug}`);
      console.log(`  店舗スラッグ: ${result.details.storeSlug}`);
      console.log(`  イベントタイプ: ${result.details.eventType}`);
      console.log(`  Post ID: ${result.details.postId}`);
      console.log(`  Canonical Key: ${result.details.canonicalKey}`);
      console.log(`  年: ${result.details.year}`);
      console.log();
    }

    console.log('='.repeat(80));
    console.log('✅ デバッグ完了！');
    console.log('='.repeat(80));
    console.log();

    if (result.prResult?.prUrl) {
      console.log('📊 次のステップ:');
      console.log(`  1. PR を確認: ${result.prResult.prUrl}`);
      console.log('  2. 記事内容をレビュー');
      console.log('  3. 問題なければマージ');
      console.log();
    }

  } catch (error) {
    console.error('\n❌ エラー発生:', error);
    if (error instanceof Error) {
      console.error('  メッセージ:', error.message);
      console.error('  スタックトレース:', error.stack);
    }
    console.log();
    console.log('='.repeat(80));
    console.log('💡 トラブルシューティング:');
    console.log('  1. URLが正しいか確認');
    console.log('  2. .env.local に必要な環境変数が設定されているか確認');
    console.log('     - ANTHROPIC_API_KEY');
    console.log('     - GITHUB_PAT');
    console.log('     - FIREBASE_PROJECT_ID (オプション)');
    console.log('  3. ネットワーク接続を確認');
    console.log('  4. DEBUG_HTML_EXTRACTION=true でHTML抽出をデバッグ');
    console.log('='.repeat(80));
    console.log();
    process.exit(1);
  }
}

main();
