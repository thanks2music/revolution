'use client';

import { useAuth } from '@/lib/auth/auth-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** ログインのエラーの表示。出さなくてよいエラー (自分でポップアップを閉じた等) は state に入らない */
export function AuthErrorAlert() {
  const { error, clearError } = useAuth();

  if (!error) return null;

  return (
    <Alert variant={error.kind === 'config' ? 'default' : 'destructive'} className="mt-4">
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {error.code ? <p className="text-xs">エラーコード: {error.code}</p> : null}
        {error.retryable ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={clearError}>
            閉じる
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
