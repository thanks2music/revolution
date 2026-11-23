/** 一覧のタブ (Figma 13 `135:425`)。#167 では「確認待ち」だけ (通報は #168 で足す) */
export function QueueTabs({ count }: { count: number }) {
  return (
    <nav className="flex border-b border-line-soft px-4" aria-label="一覧">
      <span className="flex items-center gap-1.5 border-b-2 border-bar pt-3.5 pb-3 text-sm font-bold text-ink-strong">
        確認待ち
        {count > 0 && (
          <span className="rounded-full bg-danger px-[7px] py-px text-[11px] font-bold text-white">{count}</span>
        )}
      </span>
    </nav>
  );
}
