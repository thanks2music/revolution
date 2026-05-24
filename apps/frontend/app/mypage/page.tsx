/**
 * マイページ (Crescendolls 会員機能 / M2) — 保護ルート (最小版)
 *
 * middleware が「認証済み + onboarding 完了」を保証する到達点。M2 ではユーザー名・
 * 表示名の表示とログアウトのみ提供する (詳細編集・いいね一覧・ID/メール変更・
 * パスワード後付けは M3)。
 *
 * profiles は RLS により本人行のみ select 可能。
 */

import type { Metadata } from 'next';

import Layout from '@/components/templates/Layout';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = {
  title: 'マイページ — Revolution',
  robots: { index: false, follow: false },
};

export default async function MyPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware が保護しているため通常 user は存在するが、防御的に取得する。
  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('username, display_name')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };

  return (
    <Layout>
      <section className="w-main mx-auto py-12 md:py-20">
        <SectionHeader eyebrow="Account" title="マイページ" />

        <dl className="mt-8 grid max-w-md gap-5">
          <div className="flex flex-col gap-1">
            <dt className="font-display text-xs tracking-[0.18em] text-ink-muted uppercase">
              表示名
            </dt>
            <dd className="text-lg text-ink-strong">
              {profile?.display_name || '—'}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-display text-xs tracking-[0.18em] text-ink-muted uppercase">
              ユーザー名 (ID)
            </dt>
            <dd className="font-numeric text-lg text-ink-strong">
              {profile?.username ? `@${profile.username}` : '—'}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-display text-xs tracking-[0.18em] text-ink-muted uppercase">
              メールアドレス
            </dt>
            <dd className="text-lg text-ink-body">{user?.email ?? '—'}</dd>
          </div>
        </dl>

        <p className="mt-8 max-w-prose text-sm text-ink-muted">
          プロフィール編集・いいねした記事一覧は近日公開予定です。
        </p>

        <div className="mt-8">
          <SignOutButton />
        </div>
      </section>
    </Layout>
  );
}
