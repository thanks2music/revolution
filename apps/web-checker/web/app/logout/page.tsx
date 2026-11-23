'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { buttonVariants } from '@/components/ui/button';

/**
 * ログアウト (`/logout`)。開いた時点でログアウトし、少し待ってログインの画面へ移る。
 * ヘッダーのログアウトはボタンで、待たずに移る。
 */
const REDIRECT_DELAY_MS = 3000;

export default function LogoutPage() {
  const { signOut } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  // StrictMode で effect が 2 回走っても、signOut は 1 回にする
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let timer: ReturnType<typeof setTimeout> | undefined;

    signOut()
      .then(() => {
        setState('done');
        timer = setTimeout(() => router.replace('/login'), REDIRECT_DELAY_MS);
      })
      .catch(() => setState('failed'));

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [signOut, router]);

  return (
    <main className="mx-auto grid max-w-md gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">ログアウト</h1>

      <p className="text-sm" role="status">
        {state === 'working' ? 'ログアウトしています…' : null}
        {state === 'done' ? 'ログアウトしました。' : null}
        {state === 'failed' ? 'ログアウトできませんでした。' : null}
      </p>

      {state !== 'working' ? (
        <div>
          <Link href="/login" className={buttonVariants()}>
            ログインの画面へ
          </Link>
        </div>
      ) : null}
    </main>
  );
}
