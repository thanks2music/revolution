/**
 * ネタバレの口コミの本文と写真をたたむ (Figma #3)。押すと開く。星・訪問年月・参加のしかたは、たたまずに出す。
 * ネイティブの <details> なので JS が要らず、開閉の状態も読み上げに伝わる
 */
export function SpoilerBody({
  children,
  folded,
}: {
  children: React.ReactNode;
  /** 案内に書く、たたんだ中身 (本文・写真・本文と写真) */
  folded: string;
}) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl bg-status-scheduled-surface px-3 py-3 text-xs group-open:hidden [&::-webkit-details-marker]:hidden">
        <span className="text-ink-body">ネタバレを含む口コミです（{folded}）</span>
        <span className="font-bold text-primary-strong">表示する ›</span>
      </summary>
      <div className="flex flex-col gap-2">{children}</div>
    </details>
  );
}
