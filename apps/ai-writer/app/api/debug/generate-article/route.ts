import { NextRequest } from 'next/server';
import { getClaudeService } from '../../../../lib/server/claude-api.service';
import ArticleGenerationService, { ArticleGenerationConfig } from '../../../../lib/services/article-generation.service';
import { PostStatus } from '../../../../lib/services/wordpress-graphql.service';
import type { RssArticleEntry } from '../../../../lib/types/rss-article';
import { requireAuth } from '@/lib/auth/server-auth';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * Debug endpoint: Generate article from RSS entry with progress streaming
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 🔒 認証チェック
        const authUser = await requireAuth();
        console.log(`[API /api/debug/generate-article] Authenticated user: ${authUser.email}`);

        const body = await request.json();
        const { article } = body as { article: RssArticleEntry };

        if (!article || !article.link) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            error: 'Valid article with link is required'
          })}\n\n`));
          controller.close();
          return;
        }

        console.log(`[Debug] Generating article from: ${article.title}`);

        // Step 1: URL抽出
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 1,
          totalSteps: 4,
          message: 'URL抽出中...',
          detail: 'Google Alert URLから実際の記事URLを抽出しています'
        })}\n\n`));

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

        // Step 2: 記事内容取得
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 2,
          totalSteps: 4,
          message: '記事内容取得中...',
          detail: '元記事のコンテンツを抽出しています'
        })}\n\n`));

        const claudeService = getClaudeService();

        // Step 3: AI記事生成
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 3,
          totalSteps: 4,
          message: 'AI記事生成中...',
          detail: 'Claude APIで日本語記事を生成しています（20〜30秒程度）'
        })}\n\n`));

        const generationOptions = {
          title: article.title,
          keywords: article.categories || [],
          targetLength: 600,
          tone: 'friendly' as const,
          language: 'ja' as const
        };

        const generatedArticle = await claudeService.generateArticleFromURL(
          article.link,
          generationOptions
        );

        // Step 4: WordPress投稿
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          step: 4,
          totalSteps: 4,
          message: 'WordPress投稿中...',
          detail: '生成した記事を下書きとして投稿しています'
        })}\n\n`));

        const articleService = new ArticleGenerationService(config);
        const publishRequest = {
          article: generatedArticle,
          status: PostStatus.DRAFT,
          authorId: config.defaultAuthorId,
          categoryIds: config.defaultCategoryIds
        };

        const publishResult = await articleService.publishToWordPress(publishRequest);

        if (publishResult.success) {
          console.log(`[Debug] Article generated successfully: ${publishResult.postId}`);

          // 完了
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
            }
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
        console.error('[Debug] Article generation error:', error);
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
    console.log(`[API /api/debug/generate-article] Authenticated user: ${authUser.email}`);

    return new Response(JSON.stringify({
    message: 'Debug Article Generation API',
    endpoint: 'POST /api/debug/generate-article',
    description: 'Generate article from RSS entry with progress streaming',
    body: {
      article: {
        title: 'string (required)',
        link: 'string (required)',
        description: 'string (optional)',
        content: 'string (optional)',
        pubDate: 'string (optional)',
        categories: 'string[] (optional)'
      }
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
