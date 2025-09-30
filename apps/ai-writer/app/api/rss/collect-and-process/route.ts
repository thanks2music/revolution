import { NextRequest, NextResponse } from 'next/server';
import RssArticleCollectionService from '../../../../lib/services/rss-article-collection.service';
import ArticleGenerationService, { ArticleGenerationConfig } from '../../../../lib/services/article-generation.service';
import { PostStatus } from '../../../../lib/services/wordpress-graphql.service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 設定の準備
    const {
      maxArticlesPerFeed = 5,
      processAllArticles = false,
      publishStatus = PostStatus.DRAFT,
      authorId,
      categoryIds,
      dryRun = false // trueの場合、収集のみで投稿はしない
    } = body;

    console.log('Starting RSS collection and processing...');

    // RSS記事収集サービスの設定（フィード個別の妥当性設定を使用）
    const collectionService = new RssArticleCollectionService({
      maxArticlesPerFeed
    });

    // RSS記事を収集
    console.log('Step 1: Collecting RSS articles...');
    const collectionResult = await collectionService.collectArticles();

    if (collectionResult.articles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No valid articles found in RSS feeds',
        result: {
          collection: collectionResult,
          processing: null
        }
      });
    }

    console.log(`Found ${collectionResult.articles.length} valid articles`);

    // ドライランモードの場合はここで終了
    if (dryRun) {
      return NextResponse.json({
        success: true,
        message: 'Dry run completed - articles collected but not processed',
        result: {
          collection: collectionResult,
          processing: null
        }
      });
    }

    // 記事生成・投稿の設定
    const articleConfig: ArticleGenerationConfig = {
      useClaudeAPI: true,
      wordPressEndpoint: process.env.NEXT_PUBLIC_WP_ENDPOINT!,
      wordPressAuthToken: process.env.WORDPRESS_AUTH_TOKEN,
      defaultStatus: publishStatus,
      defaultAuthorId: authorId,
      defaultCategoryIds: categoryIds
    };

    const articleService = new ArticleGenerationService(articleConfig);

    // 処理する記事数を決定
    const articlesToProcess = processAllArticles
      ? collectionResult.articles
      : collectionResult.articles.slice(0, 3); // デフォルトは最大3記事

    console.log(`Step 2: Processing ${articlesToProcess.length} articles...`);

    // 記事を生成・投稿
    const processingResults = await articleService.batchProcessRSSEntries(
      articlesToProcess,
      {
        concurrency: 1, // 慎重に1つずつ処理
        delayBetweenRequests: 3000, // 3秒間隔
        publishStatus,
        authorId,
        categoryIds
      }
    );

    const successCount = processingResults.filter(r => r.success).length;

    return NextResponse.json({
      success: true,
      message: `RSS processing completed: ${successCount}/${articlesToProcess.length} articles successfully processed`,
      result: {
        collection: collectionResult,
        processing: {
          total: articlesToProcess.length,
          successful: successCount,
          failed: articlesToProcess.length - successCount,
          results: processingResults
        }
      }
    });

  } catch (error) {
    console.error('RSS collection and processing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to collect and process RSS articles',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'RSS Collection and Processing API',
    endpoint: 'POST /api/rss/collect-and-process',
    description: 'Collect RSS articles and generate WordPress posts',
    body: {
      maxArticlesPerFeed: 'number (optional, default: 5)',
      processAllArticles: 'boolean (optional, default: false)',
      publishStatus: 'DRAFT|PUBLISH (optional, default: DRAFT)',
      authorId: 'string (optional)',
      categoryIds: 'string[] (optional)',
      dryRun: 'boolean (optional, default: false) - collect only, no processing'
    },
    workflow: [
      '1. Collect articles from active RSS feeds',
      '2. Validate articles using per-feed validation configuration',
      '3. Extract content from article URLs',
      '4. Generate articles using Claude API',
      '5. Publish to WordPress via GraphQL'
    ]
  });
}