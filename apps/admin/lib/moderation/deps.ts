import 'server-only';

import type { ModerationDeps } from '@revolution/reviews/moderation';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';

import { getAdminSession } from '@/lib/auth/admin';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * BOSS の操作に使う依存 (Server Action から)。admin でなければ null。
 * admin を Auth のサーバーに聞いて確かめた後だけ、service role のクライアントを作る
 */
export async function moderationDeps(): Promise<ModerationDeps | null> {
  const session = await getAdminSession();
  if (!session) return null;
  const serviceDb = createServiceClient();
  if (!serviceDb) throw new Error('SUPABASE_SECRET_KEY is not set');
  return { adminDb: session.supabase, serviceDb, storage: getReviewPhotoStorage() };
}
