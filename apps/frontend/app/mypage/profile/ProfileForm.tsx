'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '@revolution/schemas/username';

import { updateDisplayName, updateUsername } from '@/actions/account';

const inputClass =
  'min-h-11 rounded-xs border border-(--line-strong) bg-bg-elevated px-4 py-2 text-base text-ink-strong outline-hidden focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500';
const labelClass = 'font-display text-sm tracking-wide text-ink-strong';

/**
 * プロフィール編集の表示名とユーザー名 (Figma #12-1、one-more-time #171)。変えた欄だけを保存し、保存できたら
 * マイページに戻る。ユーザー名は変えられる (2026-11-28 BOSS。回数の制限は omt #398 で別に作る)
 */
export function ProfileForm({
  currentDisplayName,
  currentUsername,
}: {
  currentDisplayName: string;
  currentUsername: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [username, setUsername] = useState(currentUsername);
  const [errors, setErrors] = useState<{ displayName?: string; username?: string }>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        setErrors({});
        startTransition(async () => {
          const next: { displayName?: string; username?: string } = {};
          if (displayName !== currentDisplayName) {
            const result = await updateDisplayName({ displayName });
            if (!result.ok) next.displayName = result.error;
          }
          if (username !== currentUsername) {
            const result = await updateUsername({ username });
            if (!result.ok) next.username = result.error;
          }
          if (next.displayName || next.username) {
            setErrors(next);
            // 片方だけ保存できた時も、画面の元の値を読み直す (次の保存で同じ欄を送り直さないように)
            router.refresh();
            return;
          }
          router.push('/mypage');
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="profile-display-name" className={labelClass}>
          表示名
        </label>
        <input
          id="profile-display-name"
          type="text"
          value={displayName}
          onChange={event => setDisplayName(event.target.value)}
          aria-invalid={!!errors.displayName}
          aria-describedby="profile-display-name-help"
          className={inputClass}
        />
        <span id="profile-display-name-help" className="text-xs text-ink-muted">
          口コミに表示される名前です。日本語も使えます。退会すると「退会済みユーザー」と表示されます。
        </span>
        {errors.displayName && (
          <span role="alert" className="text-xs text-accent-yellow-deep">
            {errors.displayName}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="profile-username" className={labelClass}>
          ユーザー名 (ID)
        </label>
        <input
          id="profile-username"
          type="text"
          value={username}
          onChange={event => setUsername(event.target.value)}
          minLength={USERNAME_MIN_LENGTH}
          maxLength={USERNAME_MAX_LENGTH}
          aria-invalid={!!errors.username}
          aria-describedby="profile-username-help"
          className={`font-numeric ${inputClass}`}
        />
        <span id="profile-username-help" className="text-xs text-ink-muted">
          半角英数字とアンダースコア (_) のみ、{USERNAME_MIN_LENGTH}〜{USERNAME_MAX_LENGTH}
          文字。変えると、口コミなどに出る @ID も変わります。
        </span>
        {errors.username && (
          <span role="alert" className="text-xs text-accent-yellow-deep">
            {errors.username}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-primary-strong px-6 py-2.5 font-display tracking-wide text-white transition-colors hover:bg-primary-strong-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {pending ? '保存しています…' : '保存する'}
        </button>
        <span className="text-xs text-ink-muted">
          保存するとマイページに戻ります。画像は選んだ時に確認が始まります。
        </span>
        <Link href="/mypage" className="sr-only focus:not-sr-only">
          保存せずにマイページに戻る
        </Link>
      </div>
    </form>
  );
}
