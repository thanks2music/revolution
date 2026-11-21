import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ログイン中の会員の profiles.id (口コミの投稿者の列が指す永続 ID)。auth のユーザー ID とは別物
 * (shared/schemas/db/reviews.ts)。行が無ければ null (RLS で本人の行だけが見える)
 */
export async function findProfileId(
  supabase: SupabaseClient,
  authUserId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}
