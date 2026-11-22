'use client';

/**
 * 口コミの「参考になった」(one-more-time #165)。
 *
 * - 開催のページは ISR のまま描き、会員が押したかどうかは `HelpfulProvider` がマウント後に 1 回だけ取る
 *   (口コミごとに尋ねない)
 * - 押すと件数を先に画面で変え、Server Action の結果で確定する (失敗したら元に戻す)
 * - 未ログインで押すと、ログインへ案内する (戻り先はこのページ)
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { getHelpfulState, setHelpful } from '@/actions/review-helpful';

type HelpfulContextValue = { ready: boolean; isAuthed: boolean; marked: Set<number> };

const HelpfulContext = createContext<HelpfulContextValue>({
  ready: false,
  isAuthed: false,
  marked: new Set(),
});

export function HelpfulProvider(props: { reviewIds: number[]; children: ReactNode }) {
  const [value, setValue] = useState<HelpfulContextValue>({
    ready: false,
    isAuthed: false,
    marked: new Set(),
  });
  const key = props.reviewIds.join(',');

  useEffect(() => {
    let active = true;
    const ids = key ? key.split(',').map(Number) : [];
    getHelpfulState(ids)
      .then(state => {
        if (active)
          setValue({ ready: true, isAuthed: state.isAuthed, marked: new Set(state.marked) });
      })
      // 取れなくても押せるようにする (押した時にログインの要否が分かる)
      .catch(() => active && setValue(current => ({ ...current, ready: true })));
    return () => {
      active = false;
    };
  }, [key]);

  return <HelpfulContext.Provider value={value}>{props.children}</HelpfulContext.Provider>;
}

export function HelpfulButton(props: { reviewId: number; count: number }) {
  const context = useContext(HelpfulContext);
  const [override, setOverride] = useState<{ marked: boolean; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const marked = override?.marked ?? context.marked.has(props.reviewId);
  const count = override?.count ?? props.count;

  function onClick() {
    if (inFlight.current) return;
    if (context.ready && !context.isAuthed) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const next = !marked;
    const previous = { marked, count };
    inFlight.current = true;
    setError(null);
    setOverride({ marked: next, count: Math.max(0, count + (next ? 1 : -1)) });
    startTransition(async () => {
      try {
        const result = await setHelpful(props.reviewId, next);
        if (result.ok) {
          setOverride({ marked: result.marked, count: result.count });
        } else if (result.needsAuth) {
          window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        } else {
          setOverride(previous);
          setError(result.error);
        }
      } catch {
        setOverride(previous);
        setError('保存できませんでした。通信を確かめて、もう一度お試しください');
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={!context.ready || pending}
        aria-pressed={marked}
        data-testid="helpful-button"
        className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
          marked
            ? 'border-primary-600 bg-primary-50 font-bold text-primary-700'
            : 'border-(--line-soft) bg-white text-ink-muted hover:bg-muted'
        }`}
      >
        参考になった {count}
      </button>
      {error && (
        <span role="alert" className="text-xs text-status-cancelled">
          {error}
        </span>
      )}
    </span>
  );
}
