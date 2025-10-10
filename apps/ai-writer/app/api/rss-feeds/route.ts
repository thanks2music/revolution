import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '../../../lib/firebase/admin';
import type { RssFeed } from '../../../lib/types/rss-feed';

/**
 * Get list of RSS feeds using Admin SDK
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    console.log('[API] Fetching RSS feeds, activeOnly:', activeOnly);

    // Query Firestore using Admin SDK
    let query = adminDb.collection('rss_feeds').orderBy('createdAt', 'desc');

    if (activeOnly) {
      query = query.where('isActive', '==', true);
    }

    const snapshot = await query.get();

    const feeds: RssFeed[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        url: data.url,
        title: data.title,
        description: data.description,
        siteUrl: data.siteUrl,
        isActive: data.isActive,
        validationConfig: data.validationConfig || undefined,
        lastFetchedAt: data.lastFetchedAt?.toDate(),
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate(),
        createdBy: data.createdBy,
      };
    });

    console.log(`[API] Found ${feeds.length} RSS feeds`);

    return NextResponse.json({
      success: true,
      feeds,
      count: feeds.length
    });

  } catch (error) {
    console.error('[API] RSS feeds fetch error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch RSS feeds',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
