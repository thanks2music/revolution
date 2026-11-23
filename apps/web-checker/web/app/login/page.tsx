'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { AuthErrorAlert } from '@/components/auth/auth-error-alert';
import { ForbiddenNotice } from '@/components/auth/forbidden-notice';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Loading } from '@/components/loading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** ログイン (`/login`)。使ってよい人は一覧へ移し、権限の無い人にはそう伝える */
export default function LoginPage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authorized') router.replace('/');
  }, [status, router]);

  if (status === 'loading') return <Loading label="ログインの状態を確かめています" />;
  if (status === 'forbidden') return <ForbiddenNotice />;
  if (status === 'authorized') return <Loading label="一覧に移ります" />;

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold">WEB チェッカー</CardTitle>
          <CardDescription>
            ウェブページの決まった部分を見に行き、変わったら Slack に知らせます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GoogleSignInButton />
          <AuthErrorAlert />
        </CardContent>
      </Card>
    </main>
  );
}
