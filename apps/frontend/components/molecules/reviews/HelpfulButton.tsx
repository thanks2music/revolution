'use client';

/**
 * 口コミの「参考になった」(one-more-time #165)。
 *
 * - 開催のページは ISR のまま描き、会員が押したかどうかは `HelpfulProvider` がマウント後に 1 回だけ取る
 *   (口コミごとに尋ねない)
 * - 押した状態と件数は Provider が持つ (並び替えで一覧を切り替えても、押した結果を保つ)
 * - 押すと件数を先に画面で変え、Server Action の結果で確定する (失敗したら元に戻す)
 * - ログインしていない・onboarding の途中と分かっている時は、押すとそこへ案内する。分からない時
 *   (読めなかった) は押させて、Server Action の結果で案内を決める
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
import { goToLogin, goToOnboarding } from '@/lib/auth/client-redirect';

type Entry = { marked: boolean; count: number };

type HelpfulContextValue = {
  ready: boolean;
  /** 押した状態と件数 (押した後の値)。無ければページに描いた値と、マウント後に取った状態を使う */
  entries: Map<number, Entry>;
  isMarked: (reviewId: number) => boolean;
  /** 閲覧者本人の口コミ (通報の「…」を出さない、one-more-time #168) */
  isOwn: (reviewId: number) => boolean;
  toggle: (reviewId: number, current: Entry) => Promise<string | null>;
};

const HelpfulContext = createContext<HelpfulContextValue | null>(null);

export function HelpfulProvider(props: { reviewIds: number[]; children: ReactNode }) {
  // マウント後に取る閲覧者の状態 (null の間は取っている途中)
  const [state, setState] = useState<Awaited<ReturnType<typeof getHelpfulState>> | null>(null);
  const [entries, setEntries] = useState<Map<number, Entry>>(new Map());
  const inFlight = useRef(new Set<number>());
  const key = props.reviewIds.join(',');

  useEffect(() => {
    let active = true;
    // ページが作り直されて一覧が変わったら、押した後の値を捨てて、描いた値から始め直す
    setEntries(new Map());
    setState(null);
    const ids = key ? key.split(',').map(Number) : [];
    getHelpfulState(ids)
      .then(result => active && setState(result))
      // 取れなくても押せるようにする (案内は押した時の結果で分かる)
      .catch(() => active && setState({ viewer: 'unknown', marked: [], own: [] }));
    return () => {
      active = false;
    };
  }, [key]);

  const marked = useMemo(() => new Set(state?.marked), [state]);
  const own = useMemo(() => new Set(state?.own), [state]);
  const viewer = state?.viewer;

  const setEntry = useCallback((reviewId: number, entry: Entry) => {
    setEntries(current => new Map(current).set(reviewId, entry));
  }, []);

  const toggle = useCallback(
    async (reviewId: number, current: Entry): Promise<string | null> => {
      if (inFlight.current.has(reviewId)) return null;
      if (viewer === 'login' || viewer === 'onboarding') {
        if (viewer === 'login') goToLogin();
        else goToOnboarding();
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
        if (result.needs === 'login') goToLogin();
        if (result.needs === 'onboarding') goToOnboarding();
        return result.error;
      } catch {
        setEntry(reviewId, current);
        return '保存できませんでした。通信を確かめて、もう一度お試しください';
      } finally {
        inFlight.current.delete(reviewId);
      }
    },
    [viewer, setEntry]
  );

  const value = useMemo<HelpfulContextValue>(
    () => ({
      ready: state !== null,
      entries,
      isMarked: reviewId => marked.has(reviewId),
      isOwn: reviewId => own.has(reviewId),
      toggle,
    }),
    [state, entries, marked, own, toggle]
  );
  return <HelpfulContext.Provider value={value}>{props.children}</HelpfulContext.Provider>;
}

/**
 * 閲覧者の状態を読み終え、本人の口コミでないか (通報の「…」を出してよいか)。
 * 読み終える前は出さない (本人の口コミに一瞬出さないため)
 */
export function useCanReport(reviewId: number): boolean {
  const context = useContext(HelpfulContext);
  return Boolean(context?.ready && !context.isOwn(reviewId));
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
    try {
      setError(await context.toggle(props.reviewId, entry));
    } finally {
      setPending(false);
    }
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
