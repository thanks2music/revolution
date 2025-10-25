import { NextRequest, NextResponse } from 'next/server';
import RssArticleCollectionService from '../../../../lib/services/rss-article-collection.service';
import { requireAuth } from '../../../../lib/auth/server-auth';

/**
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/rss/collect] Authenticated user: ${authUser.email}`);

    const body = await request.json();

    const {
      maxArticlesPerFeed = 10
    } = body;

    console.log('Starting RSS article collection...');

    // RSS記事収集サービスの設定（フィード個別の妥当性設定を使用）
    const collectionService = new RssArticleCollectionService({
      maxArticlesPerFeed
    });

    // RSS記事を収集
    const result = await collectionService.collectArticles();

    return NextResponse.json({
      success: true,
      message: `RSS collection completed: ${result.validArticles}/${result.totalArticles} valid articles found`,
      result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('RSS collection error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to collect RSS articles',
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
    console.log(`[API /api/rss/collect] Authenticated user: ${authUser.email}`);

    return NextResponse.json({
    message: 'RSS Article Collection API',
    endpoint: 'POST /api/rss/collect',
    description: 'Collect and validate articles from registered RSS feeds using per-feed validation configuration',
    body: {
      maxArticlesPerFeed: 'number (optional, default: 10)'
    },
    validation: {
      note: 'Validation is now configured per RSS feed (keywords, language requirements, minimum score)',
      per_feed: 'Each feed uses its own ValidationConfig for article filtering',
      completeness: 'Article must have title and link'
    },
    changes: {
      v2: 'Removed global keywords and requireJapanese parameters',
      migration: 'Configure validation settings per feed in the RSS management UI'
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