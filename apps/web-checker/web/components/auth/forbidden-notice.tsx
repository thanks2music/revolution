'use client';

import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * ログインしているが、カスタムクレーム (`admin` か `allowedEditor`) が無い人に出す。
 * 別のアカウントで入り直せるよう、ログアウトのボタンを出す。
 */
export function ForbiddenNotice() {
  const { email, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <main className="mx-auto grid max-w-xl gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">WEB チェッカー</h1>

      <Alert variant="destructive">
        <AlertTitle>権限がありません</AlertTitle>
        <AlertDescription>
          <p>このアカウントには、WEB チェッカーを使う権限がありません。</p>
          {email ? <p>ログイン中のアカウント: {email}</p> : null}
        </AlertDescription>
      </Alert>

      <div>
        <Button variant="outline" onClick={() => void handleSignOut()}>
          ログアウト
        </Button>
      </div>
    </main>
  );
}
