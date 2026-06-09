'use client';

/**
 * ログアウトボタン (Crescendolls 会員機能 / M2、マイページ最小版)
 *
 * signOut (Server Action) でセッション破棄後、/login へ。マイページの詳細編集・
 * いいね一覧は M3 で実装するため、M2 は到達確認 + ログアウトのみ提供する。
 */

import { useTransition } from 'react';

import { signOut } from '@/actions/auth';

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      await signOut();
      // セッション cookie 破棄を middleware に確実に渡すためフルナビゲーション。
      window.location.assign('/login');
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="min-h-11 border border-[var(--line-strong)] bg-bg-elevated px-6 py-3 font-display tracking-wide text-ink-strong transition-colors hover:border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {isPending ? 'ログアウト中…' : 'ログアウト'}
    </button>
  );
}
