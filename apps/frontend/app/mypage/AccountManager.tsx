'use client';

/**
 * アカウント管理 UI (Crescendolls 会員機能 / M3)
 *
 * マイページのアカウント編集セクション。メール / パスワードを個別フォームで編集する
 * (表示名と ID はプロフィール編集 /mypage/profile へ移した、#171)。各フォームは独立した Server Action を呼び、成功/失敗を
 * フィールド別に表示する。
 *
 * 設計:
 * - 各フォームは `useTransition` で送信中状態を持ち、成功時はその場で表示を更新する
 *   (ページ全体のリロードはしない)。
 * - **メール変更**: メール登録ユーザーのみ可。Google ユーザーは入力を無効化し理由を表示。
 * - **パスワード設定**: パスワードレス登録のため、後付け推奨導線を出す。
 * - Sky×Lightning Editorial トークン準拠 (primary / accent-yellow、紫グラデ不使用)。
 * - アクセシビリティ: 各 input に label、エラーは role="alert"、成功は role="status"、
 *   tap target 44px 以上 (min-h-11)、フォーカスリング可視。
 */

import { useState, useTransition } from 'react';

import { updateEmail, updatePassword, type AccountResult } from '@/actions/account';

const inputClass =
  'min-h-11 rounded-xs border border-(--line-strong) bg-bg-elevated px-4 py-2 text-base text-ink-strong outline-hidden focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:bg-bg-tinted disabled:text-ink-muted';

const submitClass =
  'min-h-11 self-start bg-primary-strong px-6 py-2.5 font-display tracking-wide text-white transition-colors hover:bg-primary-strong-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60';

const labelClass = 'font-display text-sm tracking-wide text-ink-strong';

type FieldState = { error: string | null; success: string | null };

function FieldMessages({ error, success }: FieldState) {
  return (
    <>
      {error && (
        <span role="alert" className="text-xs text-accent-yellow-deep">
          {error}
        </span>
      )}
      {success && (
        <span role="status" className="text-xs text-primary-700">
          {success}
        </span>
      )}
    </>
  );
}

export function AccountManager({
  currentEmail,
  canChangeEmail,
  hasGoogle,
}: {
  currentEmail: string;
  canChangeEmail: boolean;
  hasGoogle: boolean;
}) {
  // email
  const [email, setEmail] = useState(currentEmail);
  const [emailMsg, setEmailMsg] = useState<FieldState>({ error: null, success: null });
  const [emailPending, startEmail] = useTransition();

  // password
  const [password, setPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<FieldState>({ error: null, success: null });
  const [passwordPending, startPassword] = useTransition();

  const applyResult = (
    result: AccountResult,
    setMsg: (s: FieldState) => void,
    onSuccess?: () => void
  ) => {
    if (result.ok) {
      setMsg({ error: null, success: result.message ?? '保存しました' });
      onSuccess?.();
    } else {
      setMsg({ error: result.error, success: null });
    }
  };

  return (
    <div className="mt-6 flex max-w-md flex-col gap-8">
      {/* メールアドレス */}
      <form
        onSubmit={e => {
          e.preventDefault();
          setEmailMsg({ error: null, success: null });
          startEmail(async () => {
            const result = await updateEmail({ email });
            applyResult(result, setEmailMsg);
          });
        }}
        className="flex flex-col gap-2"
        noValidate
      >
        <label htmlFor="acct-email" className={labelClass}>
          メールアドレス
        </label>
        <input
          id="acct-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={!canChangeEmail}
          autoComplete="email"
          aria-invalid={!!emailMsg.error}
          aria-describedby={!canChangeEmail ? 'acct-email-help' : undefined}
          className={inputClass}
        />
        {!canChangeEmail && (
          <span id="acct-email-help" className="text-xs text-ink-muted">
            {hasGoogle
              ? 'Google でログインしているため、メールアドレスは Google 側で管理されます。ここでは変更できません。'
              : 'このアカウントではメールアドレスを変更できません。'}
          </span>
        )}
        <FieldMessages {...emailMsg} />
        <button type="submit" disabled={emailPending || !canChangeEmail} className={submitClass}>
          {emailPending ? '送信中…' : 'メールアドレスを変更'}
        </button>
      </form>

      {/* パスワード (任意設定) */}
      <form
        onSubmit={e => {
          e.preventDefault();
          setPasswordMsg({ error: null, success: null });
          startPassword(async () => {
            const result = await updatePassword({ password });
            applyResult(result, setPasswordMsg, () => setPassword(''));
          });
        }}
        className="flex flex-col gap-2"
        noValidate
      >
        <label htmlFor="acct-password" className={labelClass}>
          パスワード (任意設定)
        </label>
        <p className="text-xs leading-relaxed text-ink-muted">
          いまはパスワードなしでログインできます。メールが使えなくなったときに備えて、パスワードを設定しておくと安心です。
        </p>
        <input
          id="acct-password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="8 文字以上"
          aria-invalid={!!passwordMsg.error}
          className={inputClass}
        />
        <FieldMessages {...passwordMsg} />
        <button type="submit" disabled={passwordPending} className={submitClass}>
          {passwordPending ? '設定中…' : 'パスワードを設定'}
        </button>
      </form>
    </div>
  );
}

export default AccountManager;
