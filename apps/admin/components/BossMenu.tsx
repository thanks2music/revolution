'use client';

import { useEffect, useRef, useState } from 'react';

import { signOut } from '@/actions/auth';

/** 上の帯の「BOSS」を押した時のメニュー (Figma F-5)。ログイン中のメールとログアウトだけ */
export function BossMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="text-xs text-bar-muted hover:text-white"
      >
        BOSS
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-7 z-20 w-56 rounded-xl border border-line bg-surface p-3 shadow-lg"
        >
          <p className="text-[11px] text-ink-muted">ログイン中</p>
          <p className="mb-3 truncate text-xs text-ink-strong">{email ?? '—'}</p>
          <form action={signOut}>
            <button type="submit" role="menuitem" className="text-sm font-bold text-danger-ink">
              ログアウト
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
