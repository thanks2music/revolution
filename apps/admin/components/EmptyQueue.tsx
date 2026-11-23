import Link from 'next/link';

import { formatDateTime } from '@/lib/moderation/format';

/** 確認待ちが 0 件の時 (Figma F-4) */
export function EmptyQueue({ checkedAt }: { checkedAt: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <span aria-hidden className="text-3xl text-primary">
        ✓
      </span>
      <p className="text-sm font-bold text-ink-strong">確認待ちの口コミはありません</p>
      <p className="text-[11px] text-ink-muted">
        最後に確かめた時刻 {formatDateTime(checkedAt)} ・{' '}
        <Link href="/" className="text-primary underline">
          読み直す
        </Link>
      </p>
    </div>
  );
}
