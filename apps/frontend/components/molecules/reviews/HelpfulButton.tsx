'use client';

/**
 * 口コミの「参考になった」(one-more-time #165)。
 *
 * - 開催のページは ISR のまま描き、会員が押したかどうかは `HelpfulProvider` がマウント後に 1 回だけ取る
 *   (口コミごとに尋ねない)
 * - 押した状態と件数は Provider が持つ (並び替えで一覧を切り替えても、押した結果を保つ)
 * - 押すと件数を先に画面で変え、Server Action の結果で確定する (失敗したら元に戻す)
 * - ログインしていないと分かっている時だけ、押した時にログインへ案内する。分からない時 (読めなかった・
 *   onboarding の途中) は押させて、Server Action の結果で案内を決める
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getHelpfulState, setHelpful } from '@/actions/review-helpful';

type Entry = { marked: boolean; count: number };

type HelpfulContextValue = {
  ready: boolean;
  /** 押した状態と件数 (押した後の値)。無ければページに描いた値と、マウント後に取った状態を使う */
  entries: Map<number, Entry>;
  isMarked: (reviewId: number) => boolean;
  toggle: (reviewId: number, current: Entry) => Promise<string | null>;
};

const HelpfulContext = createContext<HelpfulContextValue | null>(null);

function redirectTo(path: '/login' | '/onboarding') {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(path === '/login' ? `/login?next=${next}` : path);
}

export function HelpfulProvider(props: { reviewIds: number[]; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [entries, setEntries] = useState<Map<number, Entry>>(new Map());
  const inFlight = useRef(new Set<number>());
  const key = props.reviewIds.join(',');

  useEffect(() => {
    let active = true;
    const ids = key ? key.split(',').map(Number) : [];
    getHelpfulState(ids)
      .then(state => {
        if (!active) return;
        setIsAuthed(state.isAuthed);
        setMarked(new Set(state.marked));
        setReady(true);
      })
      .catch(() => {
        // 取れなくても押せるようにする (ログインの要否は押した時の結果で分かる)
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [key]);

  const setEntry = useCallback((reviewId: number, entry: Entry) => {
    setEntries(current => new Map(current).set(reviewId, entry));
  }, []);

  const toggle = useCallback(
    async (reviewId: number, current: Entry): Promise<string | null> => {
      if (inFlight.current.has(reviewId)) return null;
      if (isAuthed === false) {
        redirectTo('/login');
        return null;
      }
      const next = !current.marked;
      inFlight.current.add(reviewId);
      setEntry(reviewId, { marked: next, count: Math.max(0, current.count + (next ? 1 : -1)) });
      try {
        const result = await setHelpful(reviewId, next);
        if (result.ok) {
          setEntry(reviewId, { marked: result.marked, count: result.count });
          return null;
        }
        setEntry(reviewId, current);
        if (result.needs) redirectTo(result.needs === 'login' ? '/login' : '/onboarding');
        return result.error;
      } catch {
        setEntry(reviewId, current);
        return '保存できませんでした。通信を確かめて、もう一度お試しください';
      } finally {
        inFlight.current.delete(reviewId);
      }
    },
    [isAuthed, setEntry]
  );

  const value = useMemo<HelpfulContextValue>(
    () => ({ ready, entries, isMarked: reviewId => marked.has(reviewId), toggle }),
    [ready, entries, marked, toggle]
  );
  return <HelpfulContext.Provider value={value}>{props.children}</HelpfulContext.Provider>;
}

export function HelpfulButton(props: { reviewId: number; count: number }) {
  const context = useContext(HelpfulContext);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!context) return null;

  const entry = context.entries.get(props.reviewId) ?? {
    marked: context.isMarked(props.reviewId),
    count: props.count,
  };

  async function onClick() {
    if (!context) return;
    setError(null);
    setPending(true);
    setError(await context.toggle(props.reviewId, entry));
    setPending(false);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={!context.ready || pending}
        aria-pressed={entry.marked}
        data-testid="helpful-button"
        className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
          entry.marked
            ? 'border-primary-600 bg-primary-50 font-bold text-primary-700'
            : 'border-(--line-soft) bg-white text-ink-muted hover:bg-muted'
        }`}
      >
        参考になった {entry.count}
      </button>
      {error && (
        <span role="alert" className="text-xs text-status-cancelled">
          {error}
        </span>
      )}
    </span>
  );
}
