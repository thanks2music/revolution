'use client';

import { useState } from 'react';

/**
 * ネタバレの口コミの本文をたたむ (Figma #3)。押すと開く。星・訪問年月・参加のしかたは、たたまずに出す
 */
export function SpoilerBody({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex w-full items-center justify-between rounded-xl bg-status-scheduled-surface px-3 py-3 text-left text-xs"
    >
      <span className="text-ink-body">ネタバレを含む口コミです（本文）</span>
      <span className="font-bold text-primary-strong">表示する ›</span>
    </button>
  );
}
