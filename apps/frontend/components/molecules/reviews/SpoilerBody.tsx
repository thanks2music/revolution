/**
 * ネタバレの口コミの本文をたたむ (Figma #3)。押すと開く。星・訪問年月・参加のしかたは、たたまずに出す。
 * ネイティブの <details> なので JS が要らず、開閉の状態も読み上げに伝わる
 */
export function SpoilerBody({ children }: { children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl bg-status-scheduled-surface px-3 py-3 text-xs group-open:hidden [&::-webkit-details-marker]:hidden">
        <span className="text-ink-body">ネタバレを含む口コミです（本文）</span>
        <span className="font-bold text-primary-strong">表示する ›</span>
      </summary>
      {children}
    </details>
  );
}
