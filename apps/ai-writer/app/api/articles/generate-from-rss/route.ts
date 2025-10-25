import { NextRequest, NextResponse } from 'next/server';
import ArticleGenerationService, { ArticleGenerationConfig, RSSArticleRequest } from '../../../../lib/services/article-generation.service';
import { PostStatus } from '../../../../lib/services/wordpress-graphql.service';
import { requireAuth } from '@/lib/auth/server-auth';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/articles/generate-from-rss] Authenticated user: ${authUser.email}`);

    const body = await request.json();

    // Validate required fields
    if (!body.rssItem || !body.rssItem.title || !body.rssItem.link) {
      return NextResponse.json(
        { error: 'RSS item with title and link is required' },
        { status: 400 }
      );
    }

    // Get configuration from environment variables
    const config: ArticleGenerationConfig = {
      useClaudeAPI: true,
      wordPressEndpoint: process.env.NEXT_PUBLIC_WP_ENDPOINT!,
      wordPressAuthToken: process.env.WORDPRESS_AUTH_TOKEN,
      defaultStatus: body.defaultStatus || PostStatus.DRAFT,
      defaultAuthorId: body.defaultAuthorId,
      defaultCategoryIds: body.defaultCategoryIds
    };

    // Validate WordPress endpoint
    if (!config.wordPressEndpoint) {
      return NextResponse.json(
        { error: 'WordPress endpoint not configured' },
        { status: 500 }
      );
    }

    // Create article generation service
    const articleService = new ArticleGenerationService(config);

    // Prepare RSS article request
    const rssRequest: RSSArticleRequest = {
      rssItem: {
        title: body.rssItem.title,
        link: body.rssItem.link,
        description: body.rssItem.description,
        content: body.rssItem.content,
        pubDate: body.rssItem.pubDate,
        categories: body.rssItem.categories
      },
      generationOptions: {
        targetLength: body.targetLength || 800,
        tone: body.tone || 'professional',
        language: body.language || 'ja',
        keywords: body.keywords
      },
      publishOptions: {
        status: body.publishStatus || PostStatus.DRAFT,
        authorId: body.authorId,
        categoryIds: body.categoryIds,
        publishDate: body.publishDate,
        featuredImageUrl: body.featuredImageUrl
      }
    };

    console.log('Starting RSS article generation:', rssRequest.rssItem.title);

    // Generate and publish article from RSS
    const result = await articleService.generateAndPublishFromRSS(rssRequest);

    if (result.success) {
      return NextResponse.json({
        success: true,
        result,
        message: 'Article generated and published from RSS successfully'
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          result,
          error: result.error,
          message: 'Failed to generate or publish article from RSS'
        },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('RSS article generation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate article from RSS',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * 🔒 Protected route - requires authentication
 */
export async function GET() {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/articles/generate-from-rss] Authenticated user: ${authUser.email}`);

    return NextResponse.json({
    message: 'RSS Article Generation API',
    endpoint: 'POST /api/articles/generate-from-rss',
    description: 'Generate and publish articles from RSS feed items',
    body: {
      rssItem: {
        title: 'string (required)',
        link: 'string (required)',
        description: 'string (optional)',
        content: 'string (optional)',
        pubDate: 'string (optional)',
        categories: 'string[] (optional)'
      },
      generationOptions: {
        targetLength: 'number (optional, default: 800)',
        tone: 'professional|casual|technical|friendly (optional)',
        language: 'ja|en (optional, default: ja)',
        keywords: 'string[] (optional)'
      },
      publishOptions: {
        status: 'DRAFT|PUBLISH (optional, default: DRAFT)',
        authorId: 'string (optional)',
        categoryIds: 'string[] (optional)',
        publishDate: 'string (optional)',
        featuredImageUrl: 'string (optional)'
      },
      defaultStatus: 'DRAFT|PUBLISH (optional)',
      defaultAuthorId: 'string (optional)',
      defaultCategoryIds: 'string[] (optional)'
    }
    });
  } catch (error) {
    console.error('GET error:', error);
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
}