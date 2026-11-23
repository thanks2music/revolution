'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { ForbiddenNotice } from '@/components/auth/forbidden-notice';
import { Loading } from '@/components/loading';

/**
 * ログインが要る画面の出し分け。使い勝手のためで、データを守るのは Firestore の rules。
 *
 * 使ってよいと分かるまで children を描かない (描くと Firestore を読みに行き、permission-denied が出る)。
 * ログイン画面へは `replace` で移る (`push` だと、戻るボタンで行き来してしまう)。
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  if (status === 'loading') return <Loading label="ログインの状態を確かめています" />;
  if (status === 'unauthenticated') return <Loading label="ログインの画面に移ります" />;
  if (status === 'forbidden') return <ForbiddenNotice />;

  return <>{children}</>;
}
