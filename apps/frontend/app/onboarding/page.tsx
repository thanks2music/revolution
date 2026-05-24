/**
 * onboarding ページ (Crescendolls 会員機能 / M2) — 保護ルート
 *
 * middleware が認証 + onboarding 状態を保証する:
 *   - 未認証 → /login
 *   - 完了済み → /mypage
 * よって本ページに到達するのは「認証済み + 未完了」のユーザーのみ。
 *
 * 表示名のデフォルトは profiles.display_name (trigger が coalesce した値。Google
 * の full_name が入っていることがある) を初期値として埋める。RLS により本人行のみ
 * 取得できる。
 */

import type { Metadata } from 'next';

import Layout from '@/components/templates/Layout';
import { createClient } from '@/lib/supabase/server';
import { OnboardingForm } from './OnboardingForm';

export const metadata: Metadata = {
  title: 'プロフィール設定 — Revolution',
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const supabase = await createClient();

  // 表示名の初期値を取得 (本人行のみ RLS で取得可能)。失敗しても空で続行する。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultDisplayName = '';
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    defaultDisplayName = profile?.display_name ?? '';
  }

  return (
    <Layout>
      <section className="w-main mx-auto flex min-h-[60vh] items-center justify-center py-12 md:py-20">
        <OnboardingForm defaultDisplayName={defaultDisplayName} />
      </section>
    </Layout>
  );
}
