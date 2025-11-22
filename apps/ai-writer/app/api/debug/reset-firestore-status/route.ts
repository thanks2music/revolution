/**
 * Debug API: Reset Firestore Event Status
 *
 * Purpose:
 *   - Allow developers to reset Firestore event status for debugging
 *   - Delete event_canonical_keys document to allow re-generation
 *
 * IMPORTANT: This is a debug-only endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server-auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { getFirestore } from 'firebase-admin/firestore';
import { FIRESTORE_COLLECTIONS } from '@/lib/firestore/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/debug/reset-firestore-status
 *
 * Request body:
 * {
 *   "canonicalKey": "work-slug:store-slug:event-type:year"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Firestore status reset successfully",
 *   "canonicalKey": "..."
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const authUser = await requireAuth();
    console.log(`[API /api/debug/reset-firestore-status] Authenticated user: ${authUser.email}`);

    // Parse request body
    const body = await request.json();
    const { canonicalKey } = body;

    if (!canonicalKey) {
      return NextResponse.json(
        { success: false, error: 'canonicalKey is required' },
        { status: 400 }
      );
    }

    // Validate canonical key format
    const parts = canonicalKey.split(':');
    if (parts.length !== 4) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid canonicalKey format. Expected: workSlug:storeSlug:eventType:year'
        },
        { status: 400 }
      );
    }

    // Delete Firestore document
    getAdminDb(); // Initialize Firebase Admin SDK
    const db = getFirestore();
    const docRef = db.collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS).doc(canonicalKey);

    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      return NextResponse.json(
        {
          success: false,
          error: `Document not found: ${canonicalKey}`,
          message: 'このイベントはFirestoreに登録されていません'
        },
        { status: 404 }
      );
    }

    // Delete the document
    await docRef.delete();

    console.log(`[Reset Firestore Status] Deleted document: ${canonicalKey}`);

    return NextResponse.json({
      success: true,
      message: 'Firestoreステータスをリセットしました',
      canonicalKey,
      deletedDocument: docSnapshot.data(),
    });

  } catch (error) {
    console.error('[API /api/debug/reset-firestore-status] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
