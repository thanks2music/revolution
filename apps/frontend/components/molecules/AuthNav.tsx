'use client';

/**
 * 会員導線ナビ (Crescendolls 会員機能 / M4) — 認証状態でヘッダー・モバイル・フッターの
 * 導線を出し分ける Client Component。
 *
 * 設計 (LikeButton / getFavoriteState と同じ思想):
 * - 認証状態は cookie 依存で動的。Header / Footer は Server Component のままにして
 *   記事ルートの SSG/ISR を壊さないため、認証状態は **マウント後にクライアントから取得**
 *   する (getAuthNav Server Action)。記事本文の静的レンダリングは不変。
 * - 未ログイン: 「ログイン / 登録」(→ /login、primary 塗りボタン)。
 * - ログイン済み: 「マイページ」(→ /mypage)。
 * - 解決前 (初回マウント直後) はレイアウトシフトを避けるため、未ログイン導線
 *   (「ログイン / 登録」→ /login) を初期表示する。/login は登録 + ログイン兼用のため、
 *   万一の解決遅延でも遷移先として安全。解決後にログイン済みなら「マイページ」へ差し替わる。
 *
 * variant でレイアウトを切り替える:
 * - 'header'  : デスクトップヘッダー右の primary 塗りボタン / テキストリンク。
 * - 'mobile'  : ハンバーガー展開メニュー内の行 (tap target 44px+)。
 * - 'footer'  : フッターのリンク。
 *
 * Sky×Lightning Editorial トークン厳守 (primary 青塗り / 罫線、紫グラデ・煽り文言なし)。
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { getAuthNav } from '@/actions/auth';

type Variant = 'header' | 'mobile' | 'footer';

const LABELS = {
  loggedOut: 'ログイン / 登録',
  loggedIn: 'マイページ',
} as const;

const HREF = {
  loggedOut: '/login',
  loggedIn: '/mypage',
} as const;

export function AuthNav({
  variant,
  /** モバイルメニューのリンク tap 時にメニューを閉じるコールバック (mobile variant 用)。 */
  onNavigate,
}: {
  variant: Variant;
  onNavigate?: () => void;
}) {
  // 解決前は未ログイン導線を初期表示 (/login は登録兼ログインで遷移先として安全)。
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    let active = true;
    getAuthNav()
      .then((state) => {
        if (active) setIsAuthed(state.isAuthed);
      })
      .catch(() => {
        // 取得失敗は安全側 (未ログイン導線 = 登録誘導) のまま。記事閲覧は阻害しない。
      });
    return () => {
      active = false;
    };
  }, []);

  const label = isAuthed ? LABELS.loggedIn : LABELS.loggedOut;
  const href = isAuthed ? HREF.loggedIn : HREF.loggedOut;

  if (variant === 'header') {
    return (
      <Link
        href={href}
        className={
          isAuthed
            ? // ログイン済み: 静かなテキストリンク (nav と同トーン)。
              'font-display inline-flex min-h-11 items-center text-sm tracking-wide text-ink-strong transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'
            : // 未ログイン: primary 塗りボタン (登録への一次導線)。白文字 AA のため濃色 token。
              'font-display inline-flex min-h-11 items-center bg-primary-strong px-5 text-sm tracking-wide text-white transition-colors hover:bg-primary-strong-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'
        }
      >
        {label}
      </Link>
    );
  }

  if (variant === 'mobile') {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        className={
          isAuthed
            ? 'font-display flex min-h-11 items-center border-b py-3 text-base text-ink-strong last:border-b-0'
            : // 未ログインは塗りで強調 (登録への一次導線)。白文字 AA のため濃色 token。
              'font-display mt-2 flex min-h-11 items-center justify-center bg-primary-strong px-4 py-3 text-base tracking-wide text-white transition-colors hover:bg-primary-strong-hover'
        }
      >
        {label}
      </Link>
    );
  }

  // footer
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-sm text-ink-strong transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      {label}
    </Link>
  );
}

export default AuthNav;
