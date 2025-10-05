import { NextRequest, NextResponse } from 'next/server';
import { RssArticleCollectionService } from '../../../../lib/services/rss-article-collection.service';
import { adminDb } from '../../../../lib/firebase/admin';
import type { RssFeed } from '../../../../lib/types/rss-feed';

/**
 * Debug endpoint: Check RSS feed and return articles with validation info
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { feedId } = body;

    if (!feedId) {
      return NextResponse.json(
        { error: 'Feed ID is required' },
        { status: 400 }
      );
    }

    console.log(`[Debug] Checking RSS feed: ${feedId}`);
    console.log(`[Debug] Admin DB initialized:`, !!adminDb);
    console.log(`[Debug] Firebase Project ID:`, process.env.FIREBASE_PROJECT_ID);
    console.log(`[Debug] Firebase Client Email:`, process.env.FIREBASE_CLIENT_EMAIL);
    console.log(`[Debug] Firebase Private Key exists:`, !!process.env.FIREBASE_PRIVATE_KEY);

    // Get feed details using Admin SDK
    console.log(`[Debug] Attempting to fetch document from Firestore...`);
    const feedDoc = await adminDb.collection('rss_feeds').doc(feedId).get();
    console.log(`[Debug] Document exists:`, feedDoc.exists);

    if (!feedDoc.exists) {
      return NextResponse.json(
        { error: 'Feed not found' },
        { status: 404 }
      );
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

    // Collect articles from the feed (using feed object directly)
    const collectionService = new RssArticleCollectionService({
      maxArticlesPerFeed: 10 // Limit to 10 articles for debug
    });

    const articles = await collectionService.collectArticlesFromFeedObject(feed);

    console.log(`[Debug] Found ${articles.length} articles from feed ${feed.title}`);

    // Return articles with validation info
    return NextResponse.json({
      success: true,
      feed: {
        id: feed.id,
        title: feed.title,
        url: feed.url,
        validationConfig: feed.validationConfig
      },
      articles: articles.map(article => ({
        title: article.title,
        link: article.link,
        description: article.description,
        pubDate: article.pubDate,
        categories: article.categories,
        source: article.source
      })),
      totalArticles: articles.length
    });

  } catch (error) {
    console.error('[Debug] RSS feed check error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check RSS feed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Debug RSS Feed Check API',
    endpoint: 'POST /api/debug/check-feed',
    description: 'Check RSS feed and return articles with validation info',
    body: {
      feedId: 'string (required) - RSS feed ID to check'
    }
  });
}
