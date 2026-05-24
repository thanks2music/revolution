'use client';

/**
 * onboarding フォーム (Crescendolls 会員機能 / M2)
 *
 * 表示名 + username (unique・3-24・^[a-zA-Z0-9_]+$) を入力。completeOnboarding
 * (Server Action) で profiles update + JWT claims 反映 (案B)。
 * username 重複 (23505) / 形式エラーをフィールド別に表示する。
 *
 * 完了後は router で /mypage へ。middleware が JWT claims を再評価し、以降の
 * /onboarding 再訪は /mypage に弾く。
 */

import { useState, useTransition } from 'react';

import {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from '@revolution/schemas/profile';

import { completeOnboarding } from '@/actions/profile';

export function OnboardingForm({
  defaultDisplayName = '',
}: {
  defaultDisplayName?: string;
}) {
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(null);
    setDisplayNameError(null);
    setGeneralError(null);

    startTransition(async () => {
      const result = await completeOnboarding({ username, displayName });
      if (result.ok) {
        // 案B: completeOnboarding が updateUser で新 JWT (onboarded:true) を cookie に
        // 書き込む。soft navigation (router.replace) だと middleware が更新前の JWT を
        // 読み /onboarding に弾き返すことがあるため、フルナビゲーションで最新 cookie を
        // middleware に確実に渡す。middleware が onboarded を見て /mypage を通す。
        window.location.assign('/mypage');
        return;
      }
      if (result.field === 'username') setUsernameError(result.error);
      else if (result.field === 'displayName') setDisplayNameError(result.error);
      else setGeneralError(result.error);
    });
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-3xl text-ink-strong md:text-4xl">
        プロフィールを設定
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-body">
        あと少しで完了です。表示名とユーザー名 (ID) を決めましょう。あとから変更できます。
      </p>

      {generalError && (
        <p
          role="alert"
          className="mt-5 border-l-[3px] border-accent-yellow-deep bg-bg-tinted px-4 py-3 text-sm text-ink-strong"
        >
          {generalError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5" noValidate>
        <label className="flex flex-col gap-2">
          <span className="font-display text-sm tracking-wide text-ink-strong">
            表示名
          </span>
          <input
            type="text"
            name="displayName"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: あにめ太郎"
            aria-invalid={!!displayNameError}
            className="min-h-11 rounded-sm border border-[var(--line-strong)] bg-bg-elevated px-4 py-2 text-base text-ink-strong outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          {displayNameError && (
            <span role="alert" className="text-xs text-accent-yellow-deep">
              {displayNameError}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-display text-sm tracking-wide text-ink-strong">
            ユーザー名 (ID)
          </span>
          <input
            type="text"
            name="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="例: anime_taro"
            minLength={USERNAME_MIN_LENGTH}
            maxLength={USERNAME_MAX_LENGTH}
            aria-invalid={!!usernameError}
            aria-describedby="username-help"
            className="font-numeric min-h-11 rounded-sm border border-[var(--line-strong)] bg-bg-elevated px-4 py-2 text-base text-ink-strong outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          <span id="username-help" className="text-xs text-ink-muted">
            半角英数字とアンダースコア (_) のみ、{USERNAME_MIN_LENGTH}〜
            {USERNAME_MAX_LENGTH} 文字。
          </span>
          {usernameError && (
            <span role="alert" className="text-xs text-accent-yellow-deep">
              {usernameError}
            </span>
          )}
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 bg-primary-600 px-6 py-3 font-display tracking-wide text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isPending ? '保存中…' : 'はじめる'}
        </button>
      </form>
    </div>
  );
}
