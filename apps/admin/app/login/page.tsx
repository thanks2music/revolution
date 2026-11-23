import { AdminBar } from '@/components/AdminBar';
import { sanitizeNextPath } from '@/lib/auth/safe-redirect';

import { LoginForm } from './LoginForm';

/** 管理画面にログイン (Figma F-1・F-2)。新規登録の導線と規約の同意文は出さない */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <>
      <AdminBar />
      <main className="mx-auto max-w-md bg-surface px-4 py-8 sm:mt-8 sm:rounded-2xl sm:border sm:border-line">
        <h1 className="font-display text-xl font-bold text-ink-strong">管理画面にログイン</h1>
        <p className="mt-1 text-xs text-ink-body">管理者のアカウントでログインしてください。</p>
        <LoginForm next={sanitizeNextPath(next)} oauthFailed={error === 'auth'} />
      </main>
    </>
  );
}
