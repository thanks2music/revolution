import { NextRequest } from 'next/server';
import { RssArticleCollectionService } from '../../../../lib/services/rss-article-collection.service';
import { getAdminDb } from '../../../../lib/firebase/admin';
import { getWordPressService } from '../../../../lib/server/wordpress-graphql.service';
import ArticleGenerationService, { ArticleGenerationConfig } from '../../../../lib/services/article-generation.service';
import { PostStatus } from '../../../../lib/services/wordpress-graphql.service';
import type { RssArticleEntry } from '../../../../lib/types/rss-article';
import type { RssFeed } from '../../../../lib/types/rss-feed';
import { requireAuth } from '@/lib/auth/server-auth';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * Debug endpoint: RSSフィードから未生成記事を取得して生成
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 🔒 認証チェック
        const authUser = await requireAuth();
        console.log(`[API /api/debug/generate-from-feed] Authenticated user: ${authUser.email}`);

        const body = await request.json();
        const { feedId } = body as { feedId: string };

        if (!feedId) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            error: 'Feed ID is required'
          })}\n\n`));
          controller.close();
          return;
        }

        console.log(`[Debug] Starting article generation from feed: ${feedId}`);

        // Configuration
        const config: ArticleGenerationConfig = {
          useClaudeAPI: true,
          wordPressEndpoint: process.env.NEXT_PUBLIC_WP_ENDPOINT!,
          wordPressAuthToken: process.env.WORDPRESS_AUTH_TOKEN,
          defaultStatus: PostStatus.DRAFT,
          defaultAuthorId: process.env.WORDPRESS_DEFAULT_AUTHOR_ID,
          defaultCategoryIds: process.env.WORDPRESS_DEFAULT_CATEGORY_IDS?.split(',')
        };

        if (!config.wordPressEndpoint) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            error: 'WordPress endpoint not configured'
          })}\n\n`));
          controller.close();
          return;
        }

        // Step 1: RSSフィードから記事を取得
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 1,
          totalSteps: 5,
          message: 'RSSフィード取得中...',
          detail: 'RSSフィードから記事一覧を取得しています'
        })}\n\n`));

        // Get feed details using Admin SDK
        const adminDb = getAdminDb();
        const feedDoc = await adminDb.collection('rss_feeds').doc(feedId).get();

        if (!feedDoc.exists) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            error: 'Feed not found'
          })}\n\n`));
          controller.close();
          return;
        }

        const feedData = feedDoc.data()!;
        const feed: RssFeed = {
          id: feedDoc.id,
          url: feedData.url,
          title: feedData.title,
          description: feedData.description,
          siteUrl: feedData.siteUrl,
          isActive: feedData.isActive,
          validationConfig: feedData.validationConfig || undefined,
          lastFetchedAt: feedData.lastFetchedAt?.toDate(),
          createdAt: feedData.createdAt.toDate(),
          updatedAt: feedData.updatedAt.toDate(),
          createdBy: feedData.createdBy,
        };

        // Collect articles from the feed
        const collectionService = new RssArticleCollectionService({
          maxArticlesPerFeed: 20
        });

        const articles = await collectionService.collectArticlesFromFeedObject(feed);

        if (!articles || articles.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            error: 'No articles found in RSS feed'
          })}\n\n`));
          controller.close();
          return;
        }

        console.log(`[Debug] Found ${articles.length} articles in RSS feed`);

        // Step 2: WordPress既存記事をチェック
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 2,
          totalSteps: 5,
          message: 'WordPress既存記事をチェック中...',
          detail: '既に生成済みの記事を確認しています'
        })}\n\n`));

        const wordPressService = getWordPressService();

        // 未生成記事をフィルタリング（仮実装）
        const ungeneratedArticles: RssArticleEntry[] = [];
        for (const article of articles) {
          const existingPosts = await wordPressService.searchPostsByUrl(article.link);
          if (existingPosts.length === 0) {
            ungeneratedArticles.push(article);
          }
        }

        console.log(`[Debug] Found ${ungeneratedArticles.length} ungenerated articles`);

        if (ungeneratedArticles.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            done: true,
            success: true,
            noNewArticles: true,
            message: '新しい記事はありません'
          })}\n\n`));
          controller.close();
          return;
        }

        // 最新の1件を取得
        const articleToGenerate = ungeneratedArticles[0];
        const remainingArticles = ungeneratedArticles.slice(1);

        console.log(`[Debug] Generating article: ${articleToGenerate.title}`);

        // Step 3: URL抽出
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 3,
          totalSteps: 5,
          message: 'URL抽出中...',
          detail: 'Google Alert URLから実際の記事URLを抽出しています'
        })}\n\n`));

        // Step 4: AI記事生成 + WordPress投稿 (with automatic featured image extraction)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 4,
          totalSteps: 5,
          message: 'AI記事生成中...',
          detail: 'Claude APIで日本語記事を生成しています（20〜30秒程度）'
        })}\n\n`));

        // Step 5: WordPress投稿
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 5,
          totalSteps: 5,
          message: 'WordPress投稿中...',
          detail: 'アイキャッチ画像を抽出して記事を下書きとして投稿しています'
        })}\n\n`));

        // Use generateAndPublishFromRSS which includes automatic featured image extraction
        const articleService = new ArticleGenerationService(config);
        const publishResult = await articleService.generateAndPublishFromRSS({
          rssItem: {
            title: articleToGenerate.title,
            link: articleToGenerate.link,
            description: articleToGenerate.description,
            content: articleToGenerate.content,
            pubDate: articleToGenerate.pubDate,
            categories: articleToGenerate.categories
          },
          generationOptions: {
            title: articleToGenerate.title,
            keywords: articleToGenerate.categories || [],
            targetLength: 600,
            tone: 'friendly',
            language: 'ja'
          },
          publishOptions: {
            status: PostStatus.DRAFT,
            authorId: config.defaultAuthorId,
            categoryIds: config.defaultCategoryIds
            // featuredImageUrl is automatically extracted from article element
          }
        });

        if (publishResult.success) {
          console.log(`[Debug] Article generated successfully: ${publishResult.postId}`);

          // 完了 - 残りの記事情報も送信
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            done: true,
            success: true,
            article: {
              title: publishResult.article.title,
              content: publishResult.article.content,
              excerpt: publishResult.article.excerpt,
              slug: publishResult.article.slug,
              categories: publishResult.article.categories,
              tags: publishResult.article.tags,
              metadata: publishResult.article.metadata
            },
            wordpress: {
              postId: publishResult.postId,
              databaseId: publishResult.databaseId,
              postUrl: publishResult.postUrl,
              categories: publishResult.wordPressCategories,
              tags: publishResult.wordPressTags
            },
            remainingArticles: remainingArticles.map(a => ({
              title: a.title,
              link: a.link,
              description: a.description
            }))
          })}\n\n`));
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            done: true,
            success: false,
            error: publishResult.error
          })}\n\n`));
        }

        controller.close();

      } catch (error) {
        console.error('[Debug] Article generation from feed error:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          done: true,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * 🔒 Protected route - requires authentication
 */
export async function GET() {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/debug/generate-from-feed] Authenticated user: ${authUser.email}`);

    return new Response(JSON.stringify({
    message: 'Debug Generate From Feed API',
    endpoint: 'POST /api/debug/generate-from-feed',
    description: 'Generate article from RSS feed with automatic ungenerated article detection',
    body: {
      feedId: 'string (required)'
    }
  }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('GET error:', error);
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
