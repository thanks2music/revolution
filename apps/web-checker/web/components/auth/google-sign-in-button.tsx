'use client';

import { useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';

/** Google でログインするボタン。失敗は signIn の中で error の state に変わるので、ここでは扱わない */
export function GoogleSignInButton() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="lg" onClick={() => void handleClick()} disabled={busy}>
      {busy ? 'ログインしています…' : 'Google でログイン'}
    </Button>
  );
}
