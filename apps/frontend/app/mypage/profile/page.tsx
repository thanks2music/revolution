/**
 * プロフィール編集 (Figma #12-1 `/mypage/profile`、one-more-time #171) — 保護ルート
 *
 * プロフィール画像・表示名・ユーザー名を変える。画像は選んだ時に受け取り・審査が始まり (`AvatarField`)、
 * 表示名とユーザー名は「保存する」で保存する (`ProfileForm`)。middleware が「認証済み + onboarding 完了」を保証する。
 * 画像の状態と落ちた理由は、サーバーが service role で読む (他人には見せない列)
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import Layout from '@/components/templates/Layout';
import { AvatarField } from '@/components/molecules/profile/AvatarField';
import { getCachedUser } from '@/lib/auth/current-user';
import { loadOwnAvatarState } from '@/lib/profile/own-avatar';
import { createClient } from '@/lib/supabase/server';

import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = {
  title: 'プロフィールを編集',
  robots: { index: false, follow: false },
};

// 画像の取り込みと審査 (after) を、東京の関数で走らせる長さ (口コミの写真と同じ)
export const maxDuration = 90;

export default async function ProfileEditPage() {
  const {
    data: { user },
  } = await getCachedUser();
  const supabase = await createClient();
  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('id, username, display_name')
        .eq('auth_user_id', user.id)
        .maybeSingle()
    : { data: null };
  const avatar = profile ? await loadOwnAvatarState(profile.id as string) : null;
  const displayName = (profile?.display_name as string | null) ?? '';

  return (
    <Layout>
      <section className="w-main mx-auto max-w-md py-12 md:py-20">
        <Link
          href="/mypage"
          className="font-display text-xs text-primary-700 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          ‹ マイページ
        </Link>
        <h1 className="mt-4 font-display text-2xl text-ink-strong">プロフィールを編集</h1>
        <p className="mt-2 text-sm text-ink-body">
          口コミとマイページに出る画像・表示名・ユーザー名(ID)を変えられます。
        </p>

        {avatar && (
          <div className="mt-8 flex flex-col gap-2">
            <h2 className="font-display text-sm tracking-wide text-ink-strong">
              プロフィール画像（任意）
            </h2>
            <AvatarField name={displayName} state={avatar} />
          </div>
        )}

        <div className="mt-8">
          <ProfileForm
            currentDisplayName={displayName}
            currentUsername={(profile?.username as string | null) ?? ''}
          />
        </div>
      </section>
    </Layout>
  );
}
