import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server-auth';
import ArticleGenerationService, { ArticleGenerationConfig } from '../../../../lib/services/article-generation.service';
import { ArticleGenerationRequest } from '../../../../lib/services/claude-api.service';
import { PostStatus } from '../../../../lib/services/wordpress-graphql.service';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/articles/generate] Authenticated user: ${authUser.email}`);

    const body = await request.json();

    // Validate required fields
    if (!body.title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    // Get configuration from environment variables
    const config: ArticleGenerationConfig = {
      useClaudeAPI: true,
      wordPressEndpoint: process.env.NEXT_PUBLIC_WP_ENDPOINT!,
      wordPressAuthToken: process.env.WORDPRESS_AUTH_TOKEN,
      defaultStatus: PostStatus.DRAFT,
      defaultAuthorId: body.authorId,
      defaultCategoryIds: body.categoryIds
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

    // Prepare generation request
    const generationRequest: ArticleGenerationRequest = {
      title: body.title,
      sourceUrl: body.sourceUrl,
      sourceContent: body.sourceContent,
      keywords: body.keywords,
      targetLength: body.targetLength || 800,
      tone: body.tone || 'professional',
      language: body.language || 'ja'
    };

    console.log('Starting article generation:', generationRequest.title);

    // Generate article
    const generatedArticle = await articleService.generateArticle(generationRequest);

    // Check if user wants to publish immediately
    if (body.publishImmediately) {
      const publishResult = await articleService.publishToWordPress({
        article: generatedArticle,
        status: body.publishStatus || PostStatus.DRAFT,
        authorId: body.authorId,
        categoryIds: body.categoryIds,
        publishDate: body.publishDate,
        featuredImageUrl: body.featuredImageUrl
      });

      return NextResponse.json({
        success: publishResult.success,
        article: generatedArticle,
        publication: publishResult,
        message: publishResult.success
          ? 'Article generated and published successfully'
          : 'Article generated but publishing failed'
      });
    }

    // Return generated article without publishing
    return NextResponse.json({
      success: true,
      article: generatedArticle,
      message: 'Article generated successfully'
    });

  } catch (error) {
    console.error('Article generation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate article',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Article Generation API',
    endpoints: {
      POST: 'Generate article with Claude API',
      body: {
        title: 'string (required)',
        sourceUrl: 'string (optional)',
        sourceContent: 'string (optional)',
        keywords: 'string[] (optional)',
        targetLength: 'number (optional, default: 800)',
        tone: 'professional|casual|technical|friendly (optional)',
        language: 'ja|en (optional, default: ja)',
        publishImmediately: 'boolean (optional)',
        publishStatus: 'DRAFT|PUBLISH (optional)',
        authorId: 'string (optional)',
        categoryIds: 'string[] (optional)',
        publishDate: 'string (optional)',
        featuredImageUrl: 'string (optional)'
      }
    }
  });
}