'use client';

/**
 * 会員導線ナビ (Crescendolls 会員機能 / M4) — 認証状態でヘッダー・モバイル・フッターの
 * 導線を出し分ける Client Component。
 *
 * 設計 (LikeButton / getFavoriteState と同じ思想):
 * - 認証状態は cookie 依存で動的。Header / Footer は Server Component のままにして
 *   記事ルートの SSG/ISR を壊さないため、認証状態は **マウント後にクライアントから取得**
 *   する。記事本文の静的レンダリングは不変。
 * - **認証状態は AuthNavProvider (Context) から購読する** (Vercel 監査 / client-swr-dedup)。
 *   従来は各 AuthNav インスタンス (header / mobile / footer) が個別に getAuthNav() を呼び
 *   1 ページで 3 往復していたが、Provider がマウント時 1 回だけ取得した値を全インスタンスが
 *   共有することで往復は 3 → 1 に集約される。
 * - 未ログイン: 「ログイン / 登録」(→ /login、primary 塗りボタン)。
 * - ログイン済み: 「マイページ」(→ /mypage)。
 * - 解決前 (初回マウント直後) はレイアウトシフトを避けるため、未ログイン導線
 *   (「ログイン / 登録」→ /login) を初期表示する (Provider の初期値 isAuthed:false)。
 *   /login は登録 + ログイン兼用のため、万一の解決遅延でも遷移先として安全。
 *   解決後にログイン済みなら「マイページ」へ差し替わる。
 *
 * variant でレイアウトを切り替える:
 * - 'header'  : デスクトップヘッダー右の primary 塗りボタン / テキストリンク。
 * - 'mobile'  : ハンバーガー展開メニュー内の行 (tap target 44px+)。
 * - 'footer'  : フッターのリンク。
 *
 * Sky×Lightning Editorial トークン厳守 (primary 青塗り / 罫線、紫グラデ・煽り文言なし)。
 */

import Link from 'next/link';

import { useAuthNav } from '@/components/molecules/AuthNavProvider';

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
  // 認証状態は AuthNavProvider (Context) から購読。Provider がマウント時 1 回だけ
  // getAuthNav() を取得し、全 AuthNav インスタンスがその値を共有する (往復 3→1)。
  const { isAuthed } = useAuthNav();

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
