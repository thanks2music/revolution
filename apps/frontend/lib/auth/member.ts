import 'server-only';

import { getCachedUser } from '@/lib/auth/current-user';
import { isOnboardedFromMetadata } from '@/lib/auth/onboarding-status';
import { createClient } from '@/lib/supabase/server';

/**
 * 書き込める会員か (ログイン済み・onboarding 済み・profiles の行がある) を確かめ、profiles.id を返す。
 *
 * profiles.id は口コミなどの投稿者の列が指す永続 ID で、auth のユーザー ID とは別物
 * (shared/schemas/db/reviews.ts)。今は M1 で両者が同じ値だが、M2 で分かれる。
 *
 * Server Action はどのルートからも呼べるので、middleware の onboarding の強制に頼らず、書き込む側で
 * これを呼ぶ。profiles の読み込みに失敗した時は投げる (呼び出し側が「確かめられない」として扱う)。
 */
export type CurrentMember =
  | { ok: true; profileId: string }
  | { ok: false; reason: 'unauthenticated' | 'not_onboarded' | 'no_profile' };

export async function getCurrentMember(): Promise<CurrentMember> {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return { ok: false, reason: 'unauthenticated' };
  if (!isOnboardedFromMetadata(user.user_metadata)) return { ok: false, reason: 'not_onboarded' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: 'no_profile' };
  return { ok: true, profileId: data.id as string };
}
