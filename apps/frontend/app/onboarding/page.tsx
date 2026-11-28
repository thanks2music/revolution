/**
 * onboarding ページ (Crescendolls 会員機能 / M2) — 保護ルート
 *
 * middleware が認証 + onboarding 状態を保証する:
 *   - 未認証 → /login
 *   - 完了済み → 戻り先 (?next=、無ければ /mypage)
 * よって本ページに到達するのは「認証済み + 未完了」のユーザーのみ。
 *
 * 表示名のデフォルトは profiles.display_name (trigger が coalesce した値。Google
 * の full_name が入っていることがある) を初期値として埋める。RLS により本人行のみ
 * 取得できる。
 */

import type { OwnAvatarState } from '@/components/molecules/profile/AvatarField';
import { loadOwnAvatarState } from '@/lib/profile/own-avatar';
import type { Metadata } from 'next';

import Layout from '@/components/templates/Layout';
import { sanitizeNextPath } from '@/lib/auth/safe-redirect';
import { createClient } from '@/lib/supabase/server';
import { OnboardingForm } from './OnboardingForm';

// 任意のプロフィール画像の取り込みと審査 (after) を走らせる長さ (#171、口コミの写真と同じ)
export const maxDuration = 90;

export const metadata: Metadata = {
  title: 'プロフィール設定',
  robots: { index: false, follow: false },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // 終わったら来た画面へ戻す (one-more-time #166)。無い・外部の URL は /mypage に倒れる
  const { next } = await searchParams;
  const safeNext = sanitizeNextPath(next ?? null);

  const supabase = await createClient();

  // 表示名の初期値を取得 (本人行のみ RLS で取得可能)。失敗しても空で続行する。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultDisplayName = '';
  let avatar: OwnAvatarState | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    defaultDisplayName = profile?.display_name ?? '';
    if (profile) avatar = await loadOwnAvatarState(profile.id as string);
  }

  return (
    <Layout>
      <section className="w-main mx-auto flex min-h-[60vh] items-center justify-center py-12 md:py-20">
        <OnboardingForm defaultDisplayName={defaultDisplayName} next={safeNext} avatar={avatar} />
      </section>
    </Layout>
  );
}
