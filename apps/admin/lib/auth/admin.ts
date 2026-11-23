import 'server-only';

import { isAdminClaims } from '@/lib/auth/claims';
import { createClient } from '@/lib/supabase/server';

/**
 * 管理アプリに入れるか。印は app_metadata.role = 'admin' (one-more-time #167、本人が書き換えられない値)。
 *
 * - 画面の入口 (proxy.ts) は JWT の claims で見る (速い。トークンの期限までは古い値のことがある)
 * - Server Action とページは、ここで Auth のサーバーに今の値を聞く (getUser)
 * - DB の関数の中でも auth.users の今の値で確かめる (migration 0026 の private.assert_admin)
 */

export type AdminSession = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  email: string | null;
};

/** ログイン中で admin なら、そのクライアント。そうでなければ null */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAdminClaims({ app_metadata: data.user.app_metadata })) return null;
  return { supabase, email: data.user.email ?? null };
}
