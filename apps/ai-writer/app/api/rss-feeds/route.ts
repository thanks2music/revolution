import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '../../../lib/firebase/admin';
import { requireAuth } from '@/lib/auth/server-auth';
import type { RssFeed } from '../../../lib/types/rss-feed';
import { rssFeedFromDoc } from '../../../lib/firestore/rss-feed-doc';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * Get list of RSS feeds using Admin SDK
 * 🔒 Protected route - requires authentication
 */
export async function GET(request: NextRequest) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/rss-feeds] Authenticated user: ${authUser.email}`);

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    console.log('[API] Fetching RSS feeds, activeOnly:', activeOnly);

    // Query Firestore using Admin SDK
    const adminDb = getAdminDb();
    let query = adminDb.collection('rss_feeds').orderBy('createdAt', 'desc');

    if (activeOnly) {
      query = query.where('isActive', '==', true);
    }

    const snapshot = await query.get();

    const feeds: RssFeed[] = snapshot.docs.map((doc) => rssFeedFromDoc(doc.id, doc.data()));

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
