import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/server-auth';
import { registeredUrlDeps, toAttemptView, toRegisteredUrlView } from '@/lib/scheduled/registered-url-api';
import { listRegisteredUrls, registerUrl } from '@/lib/scheduled/registered-urls';

export const dynamic = 'force-dynamic';

/**
 * URLs registered for the scheduled run, with what happened to each.
 * 🔒 Protected route - requires authentication
 */
export async function GET() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const entries = await listRegisteredUrls(registeredUrlDeps());
    return NextResponse.json({ success: true, urls: entries.map(toRegisteredUrlView) });
  } catch (error) {
    console.error('[API /api/registered-urls] List failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to load registered URLs' }, { status: 500 });
  }
}

/**
 * Register a URL. A URL that was tried before is not registered; its result is returned (409).
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== 'string') {
    return NextResponse.json({ success: false, error: 'url is required' }, { status: 400 });
  }

  try {
    const result = await registerUrl(registeredUrlDeps(), body.url, user.email, new Date());
    switch (result.kind) {
      case 'registered':
        return NextResponse.json({ success: true, url: toRegisteredUrlView(result.registered) }, { status: 201 });
      case 'invalid':
        return NextResponse.json({ success: false, error: result.message }, { status: 400 });
      case 'already-attempted':
        return NextResponse.json(
          { success: false, reason: 'already-attempted', attempt: toAttemptView(result.attempt) },
          { status: 409 },
        );
      case 'already-registered':
        return NextResponse.json({ success: false, reason: 'already-registered' }, { status: 409 });
    }
  } catch (error) {
    console.error('[API /api/registered-urls] Register failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to register the URL' }, { status: 500 });
  }
}
