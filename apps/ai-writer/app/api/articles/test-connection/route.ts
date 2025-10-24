import { NextRequest, NextResponse } from 'next/server';
import ArticleGenerationService, { ArticleGenerationConfig } from '../../../../lib/services/article-generation.service';
import { PostStatus } from '../../../../lib/services/wordpress-graphql.service';
import { requireAuth } from '@/lib/auth/server-auth';

/**
 * 🔒 Protected route - requires authentication
 */
export async function GET() {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/articles/test-connection] Authenticated user: ${authUser.email}`);
    // Get configuration from environment variables
    const config: ArticleGenerationConfig = {
      useClaudeAPI: true,
      wordPressEndpoint: process.env.NEXT_PUBLIC_WP_ENDPOINT!,
      wordPressAuthToken: process.env.WORDPRESS_AUTH_TOKEN,
      defaultStatus: PostStatus.DRAFT
    };

    // Validate configuration
    if (!config.wordPressEndpoint) {
      return NextResponse.json(
        {
          success: false,
          error: 'WordPress endpoint not configured',
          details: 'NEXT_PUBLIC_WP_ENDPOINT environment variable is missing'
        },
        { status: 500 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: 'Anthropic API key not configured',
          details: 'ANTHROPIC_API_KEY environment variable is missing'
        },
        { status: 500 }
      );
    }

    // Create article generation service
    const articleService = new ArticleGenerationService(config);

    console.log('Testing connections to Claude API and WordPress GraphQL...');

    // Test connections
    const connectionResults = await articleService.testConnections();

    const success = connectionResults.claude && connectionResults.wordpress;

    return NextResponse.json({
      success,
      connections: {
        claude: {
          status: connectionResults.claude ? 'connected' : 'failed',
          enabled: config.useClaudeAPI
        },
        wordpress: {
          status: connectionResults.wordpress ? 'connected' : 'failed',
          endpoint: config.wordPressEndpoint,
          hasAuthToken: !!config.wordPressAuthToken
        }
      },
      errors: connectionResults.errors,
      message: success
        ? 'All connections successful'
        : 'One or more connections failed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Connection test error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Connection test failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/articles/test-connection] Authenticated user: ${authUser.email}`);

    const body = await request.json();

    // Get configuration from request body or environment
    const config: ArticleGenerationConfig = {
      useClaudeAPI: body.testClaude !== false,
      wordPressEndpoint: body.wordPressEndpoint || process.env.NEXT_PUBLIC_WP_ENDPOINT!,
      wordPressAuthToken: body.wordPressAuthToken || process.env.WORDPRESS_AUTH_TOKEN,
      defaultStatus: PostStatus.DRAFT
    };

    // Create article generation service
    const articleService = new ArticleGenerationService(config);

    // Test connections with custom configuration
    const connectionResults = await articleService.testConnections();

    const success = connectionResults.claude && connectionResults.wordpress;

    return NextResponse.json({
      success,
      connections: {
        claude: {
          status: connectionResults.claude ? 'connected' : 'failed',
          enabled: config.useClaudeAPI
        },
        wordpress: {
          status: connectionResults.wordpress ? 'connected' : 'failed',
          endpoint: config.wordPressEndpoint,
          hasAuthToken: !!config.wordPressAuthToken
        }
      },
      errors: connectionResults.errors,
      message: success
        ? 'All connections successful'
        : 'One or more connections failed',
      timestamp: new Date().toISOString(),
      testedWith: 'custom configuration'
    });

  } catch (error) {
    console.error('Custom connection test error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Custom connection test failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}