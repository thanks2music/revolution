'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';

/** 共通のヘッダー。どの幅でもログアウトできるよう、折りたたまない */
export function AppHeader() {
  const { email, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold">
          WEB チェッカー
        </Link>

        <div className="flex items-center gap-3">
          {email ? <span className="text-sm text-muted-foreground">{email}</span> : null}
          <Button variant="ghost" onClick={() => void handleSignOut()}>
            ログアウト
          </Button>
        </div>
      </div>
    </header>
  );
}
