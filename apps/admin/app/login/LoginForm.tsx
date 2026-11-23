'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { sendCode, verifyCode } from '@/actions/auth';
import { createClient } from '@/lib/supabase/client';

/**
 * メールのワンタイムコード (メール → 6 桁のコード) と Google (Figma F-1・F-2)。
 * Google はリダイレクトを伴うのでブラウザから始め、/auth/callback でセッションにする
 */
export function LoginForm({ next, oauthFailed }: { next: string; oauthFailed: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(
    oauthFailed ? 'Google でのログインに失敗しました。もう一度お試しください。' : null
  );
  const [pending, startTransition] = useTransition();

  const submitEmail = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await sendCode(email);
      if (result.ok) setStep('code');
      else setError(result.error);
    });
  };

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await verifyCode(email, code);
      if (result.ok) router.replace(next);
      else setError(result.error);
    });
  };

  const signInWithGoogle = async () => {
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) setError('Google でのログインを始められませんでした。');
  };

  const input =
    'mt-1 w-full rounded-xl border border-line bg-surface px-3 py-3 text-base text-ink-strong focus:border-primary focus:outline-none';
  const primary =
    'mt-4 w-full rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-45';

  return (
    <div className="mt-6">
      {step === 'email' ? (
        <form onSubmit={submitEmail} noValidate>
          <label className="text-xs font-bold text-ink-strong">
            メールアドレス
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="boss@example.com"
              className={input}
            />
          </label>
          <button type="submit" disabled={pending || !email} className={primary}>
            確認コードを送る
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} noValidate>
          <p className="rounded-lg bg-info-surface px-3 py-2 text-xs text-info-ink">
            {email} に 6 桁のコードを送りました。
          </p>
          <label className="mt-4 block text-xs font-bold text-ink-strong">
            確認コード
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, ''))}
              className={`${input} text-center text-2xl tracking-[0.4em]`}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <button type="submit" disabled={pending || code.length !== 6} className={primary}>
            ログイン
          </button>
          <p className="mt-3 flex gap-4 text-xs">
            <button
              type="button"
              className="text-primary disabled:opacity-45"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await sendCode(email);
                  if (!result.ok) setError(result.error);
                });
              }}
            >
              コードを送り直す
            </button>
            <button type="button" className="text-primary" onClick={() => setStep('email')}>
              メールアドレスを変える
            </button>
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-surface px-3 py-2 text-xs text-danger-ink">
          {error}
        </p>
      )}
      {step === 'email' && (
        <>
          <p className="my-5 text-center text-xs text-ink-muted">または</p>
          <button
            type="button"
            onClick={signInWithGoogle}
            className="w-full rounded-xl border border-line bg-surface py-3.5 text-sm font-bold text-ink-strong hover:bg-surface-subtle"
          >
            Google でログイン
          </button>
        </>
      )}
    </div>
  );
}
