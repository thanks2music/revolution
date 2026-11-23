import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * service role のクライアント。配信側への写し・消しと、もう一度 AI にかけた後の審査だけに使う。
 * 呼ぶ前に、ログイン中の会員が admin であることを確かめる (lib/auth/admin.ts の requireAdmin)
 */
export function createServiceClient() {
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!secretKey) return null;
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
