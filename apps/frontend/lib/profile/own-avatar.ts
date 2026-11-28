import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { readOwnAvatar } from '@revolution/reviews/avatar/operations';
import { toAvatarView, type OwnAvatarState } from '@revolution/reviews/avatar/view';
import { publicMediaBaseUrl } from '@revolution/reviews/photos/public';

/**
 * 本人のプロフィール画像の状態 (one-more-time #171)。状態と落ちた理由は他人に見せない列なので、サーバーが
 * service role で読む。鍵の無い環境 (Preview など) と読めない時は null (欄を出さない)
 */
export async function loadOwnAvatarState(profileId: string): Promise<OwnAvatarState | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  try {
    const own = await readOwnAvatar(admin, profileId);
    const baseUrl = publicMediaBaseUrl(env.REVIEW_PUBLIC_MEDIA_BASE_URL);
    return {
      status: own.status,
      view:
        own.status === 'published' && own.key && baseUrl ? toAvatarView(baseUrl, own.key) : null,
      reasonCode: own.reasonCode,
      removed: own.removed,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { part: 'own-avatar' } });
    return null;
  }
}
