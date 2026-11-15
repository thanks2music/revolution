import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/server-auth';
import { registeredUrlDeps } from '@/lib/scheduled/registered-url-api';
import { unregisterUrl } from '@/lib/scheduled/registered-urls';

export const dynamic = 'force-dynamic';

/**
 * Remove a registration. The attempt record stays; a URL waiting for a retry is given up.
 * 🔒 Protected route - requires authentication
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  // The ID is always the SHA-256 of the URL; anything else cannot exist (and could be an invalid path)
  if (!/^[0-9a-f]{64}$/.test(id)) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  try {
    const removed = await unregisterUrl(registeredUrlDeps(), id);
    return removed
      ? NextResponse.json({ success: true })
      : NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[API /api/registered-urls/[id]] Remove failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to remove the registration' }, { status: 500 });
  }
}
