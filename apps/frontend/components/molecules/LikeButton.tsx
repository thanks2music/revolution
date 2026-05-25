'use client';

/**
 * いいねボタン (Crescendolls 会員機能 / M3) — optimistic UI
 *
 * 記事詳細ページに置く。記事本文の静的レンダリング (ISR revalidate=120) を壊さないよう、
 * いいね状態 (cookie 依存・動的) は **マウント後にクライアントから取得** する
 * (Server Component で cookie を読むと記事ルート全体が動的化するため)。
 *
 * 設計:
 * - **初期取得**: マウント時に getFavoriteState(targetKey) で isAuthed / liked を解決。
 *   解決前はボタンを無効化し、未いいね見た目のプレースホルダを出す (レイアウトシフト無)。
 * - **optimistic UI**: クリック直後に liked を反転して描画 → Server Action の結果で
 *   確定 / 失敗時ロールバック。
 * - **未認証**: クリック時に `/login?next=<現在のパス>` へ誘導 (記事は読めるが、
 *   いいねにはログインが要る)。toggleFavorite が needsAuth を返した場合も同様。
 * - **アクセシビリティ**: `aria-pressed` でトグル状態、tap target 44px 以上 (min-h-11)、
 *   フォーカスリング可視。
 * - Sky×Lightning Editorial トークン準拠 (primary / accent-yellow、白カード/紫グラデ不使用)。
 */

import { useEffect, useState, useTransition } from 'react';

import { getFavoriteState, toggleFavorite } from '@/actions/favorite';

type Props = {
  /** buildArticleKey(article) で生成した favorites.target_key。 */
  targetKey: string;
};

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

function goToLogin() {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`/login?next=${next}`);
}

export function LikeButton({ targetKey }: Props) {
  const [ready, setReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [liked, setLiked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // マウント後にいいね状態を取得 (記事ルートを動的化させないため client 側で解決)。
  useEffect(() => {
    let active = true;
    getFavoriteState(targetKey)
      .then((state) => {
        if (!active) return;
        setIsAuthed(state.isAuthed);
        setLiked(state.liked);
        setReady(true);
      })
      .catch(() => {
        // 取得失敗 (ネットワーク断 / サーバ例外) でもボタンを無限 disabled に
        // しない。ready を true にして操作可能へ戻し、リカバリ可能なエラーを表示。
        // isAuthed は安全側 (false) のまま → クリックで /login へ誘導され、
        // ログイン後に再取得される。
        if (!active) return;
        setError('いいね状態を取得できませんでした');
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [targetKey]);

  const handleClick = () => {
    setError(null);

    // 未認証は往復せず即 /login へ。
    if (!isAuthed) {
      goToLogin();
      return;
    }

    // optimistic: 即時反転して描画。失敗時に元へ戻す。
    const previous = liked;
    setLiked(!liked);

    startTransition(async () => {
      try {
        const result = await toggleFavorite(targetKey);
        if (result.ok) {
          // サーバ確定値で同期 (冪等な 23505 ケースも反映)。
          setLiked(result.liked);
          return;
        }
        // 型付き失敗 ({ ok:false }) のロールバック
        setLiked(previous);
        if (result.needsAuth) {
          goToLogin();
          return;
        }
        setError(result.error);
      } catch {
        // transport 例外 (Server Action POST の fetch reject / サーバ 500 等)。
        // throw のままだと error boundary (app/error.tsx) が発火し記事ページから
        // 離脱してしまうため、ここで握って optimistic をロールバック + 汎用文言。
        setLiked(previous);
        setError('通信に失敗しました。時間をおいて再度お試しください。');
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={!ready || isPending}
        aria-pressed={liked}
        aria-busy={!ready}
        aria-label={liked ? 'いいねを解除' : 'この記事をいいね'}
        className={`
          inline-flex min-h-11 items-center gap-2 border px-5 py-2.5
          font-display tracking-wide transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
          disabled:cursor-default disabled:opacity-70
          ${
            liked
              ? 'border-accent-yellow-deep bg-accent-yellow text-ink-strong'
              : 'border-[var(--line-strong)] bg-bg-elevated text-ink-strong hover:border-primary-500 hover:text-primary-700'
          }
        `}
      >
        <HeartIcon filled={liked} />
        <span>{liked ? 'いいね済み' : 'いいね'}</span>
      </button>
      {error && (
        <span role="alert" className="text-xs text-accent-yellow-deep">
          {error}
        </span>
      )}
    </div>
  );
}

export default LikeButton;
