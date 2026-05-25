'use client';

/**
 * ログインフォーム (Crescendolls 会員機能 / M2)
 *
 * パスワードレス:
 *   - Email OTP: sendOtp (Server Action) → 6 桁入力 → verifyOtp (Server Action) →
 *     セッション確立後 router で遷移 (middleware が onboarding 状態に応じ再誘導)。
 *   - Google: createClient().auth.signInWithOAuth({ provider:'google',
 *     options:{ redirectTo:`${origin}/auth/callback` }}) でブラウザ遷移。
 *
 * 2 段階 UI (email 入力 → code 入力)。Sky×Lightning Editorial トークン準拠。
 */

import { useState, useTransition } from 'react';

import { sendOtp, verifyOtp } from '@/actions/auth';
import { sanitizeNextPath } from '@/lib/auth/safe-redirect';
import { createClient } from '@/lib/supabase/client';

type Step = 'email' | 'code';

export function LoginForm({
  initialError,
  next,
}: {
  initialError?: string;
  /** verify 成功後の遷移先 (相対パスのみ。未指定は /mypage)。 */
  next?: string;
}) {
  // open redirect 防止 (二重防御): page.tsx で既にサニタイズ済みだが、verify 成功後の
  // window.location.assign 直前にも共有サニタイザを通し、不正な next での外部遷移を
  // クライアント側でも確実に防ぐ。callback / login/page と同一ロジックを共有する。
  const destination = sanitizeNextPath(next ?? null);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(
    initialError ? 'ログインに失敗しました。もう一度お試しください。' : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sendOtp(email);
      if (result.ok) {
        setStep('code');
        setNotice('確認コードをメールに送信しました。届いた 6 桁を入力してください。');
      } else {
        setMessage(result.error);
      }
    });
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await verifyOtp(email, code);
      if (result.ok) {
        // セッション cookie 確立直後はフルナビゲーションで最新 cookie を middleware に
        // 渡す (soft navigation だと確立前の状態で middleware を通過しうる)。
        // 遷移先は next (なければ /mypage)。未 onboarding なら middleware が
        // /onboarding へ誘導する (next が保護ルートでも middleware が再判定)。
        window.location.assign(destination);
      } else {
        setMessage(result.error);
      }
    });
  };

  // provider 未設定 (ローカル / 本番で Google 未有効化) のときに、生の JSON エラー
  // ページへ遷移してしまうのを防ぐための友好的メッセージ。
  const GOOGLE_UNAVAILABLE_MESSAGE =
    'Google ログインは現在ご利用いただけません。メールでの登録をご利用ください。';

  const handleGoogle = async () => {
    setMessage(null);
    setGoogleLoading(true);
    const supabase = createClient();

    // skipBrowserRedirect で自動遷移を止め、authorize URL を自前で扱う。
    // 注: provider 未設定でも signInWithOAuth は error:null + data.url を返すため、
    // error だけでは未設定を検知できない (実測)。data.url を取得後、遷移前に
    // authorize エンドポイントを先読みして provider 無効 (4xx + 生 JSON) を検知する。
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      setGoogleLoading(false);
      setMessage(GOOGLE_UNAVAILABLE_MESSAGE);
      return;
    }

    // authorize URL を遷移前に先読みし、provider 無効 (4xx の生 JSON) を検知する。
    // - 本番 (Google 有効): 同意画面へクロスオリジン 302 → fetch は opaqueredirect
    //   (status 0)。4xx ではないので通常遷移する。
    // - ローカル / 未設定: 同一オリジンで 400 + JSON。遷移させず友好的メッセージを出す。
    try {
      const probe = await fetch(data.url, { method: 'GET', redirect: 'manual' });
      // status >= 400 は provider 無効など。生 JSON を見せず友好的メッセージへ。
      if (probe.status >= 400) {
        setGoogleLoading(false);
        setMessage(GOOGLE_UNAVAILABLE_MESSAGE);
        return;
      }
    } catch {
      // 先読みに失敗した場合は、生 JSON 露出を避けるため遷移を中止する。
      // 本番で Google が有効なら 302 (opaqueredirect) で probe は成功するため、
      // ここに来るのはネットワーク異常等の例外時のみ。
      setGoogleLoading(false);
      setMessage(GOOGLE_UNAVAILABLE_MESSAGE);
      return;
    }

    // provider 有効。通常の OAuth 遷移を行う (Google 同意画面へ)。
    window.location.assign(data.url);
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-3xl text-ink-strong md:text-4xl">
        ログイン / 登録
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-body">
        パスワードは不要です。メールに届く 6 桁コード、または Google でログインできます。
      </p>

      {message && (
        <p
          role="alert"
          className="mt-5 border-l-[3px] border-accent-yellow-deep bg-bg-tinted px-4 py-3 text-sm text-ink-strong"
        >
          {message}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-5 border-l-[3px] border-primary-500 bg-bg-tinted px-4 py-3 text-sm text-ink-strong"
        >
          {notice}
        </p>
      )}

      {step === 'email' ? (
        <form onSubmit={handleSendOtp} className="mt-7 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="font-display text-sm tracking-wide text-ink-strong">
              メールアドレス
            </span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="min-h-11 rounded-sm border border-[var(--line-strong)] bg-bg-elevated px-4 py-2 text-base text-ink-strong outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="min-h-11 bg-primary-strong px-6 py-3 font-display tracking-wide text-white transition-colors hover:bg-primary-strong-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {isPending ? '送信中…' : 'コードを送信'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="mt-7 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="font-display text-sm tracking-wide text-ink-strong">
              確認コード (6 桁)
            </span>
            <input
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="font-numeric min-h-11 rounded-sm border border-[var(--line-strong)] bg-bg-elevated px-4 py-2 text-2xl tracking-[0.4em] text-ink-strong tabular-nums outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="min-h-11 bg-primary-strong px-6 py-3 font-display tracking-wide text-white transition-colors hover:bg-primary-strong-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {isPending ? '確認中…' : 'ログイン'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('email');
              setCode('');
              setMessage(null);
              setNotice(null);
            }}
            className="self-start text-sm text-primary-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            ← メールアドレスを変更
          </button>
        </form>
      )}

      <div className="my-7 flex items-center gap-3 text-xs text-ink-muted">
        <span className="h-px flex-1 bg-[var(--line-soft)]" aria-hidden="true" />
        または
        <span className="h-px flex-1 bg-[var(--line-soft)]" aria-hidden="true" />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={googleLoading}
        className="flex min-h-11 w-full items-center justify-center gap-2 border border-[var(--line-strong)] bg-bg-elevated px-6 py-3 font-display tracking-wide text-ink-strong transition-colors hover:border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {googleLoading ? 'Google へ移動中…' : 'Google でログイン'}
      </button>
    </div>
  );
}
