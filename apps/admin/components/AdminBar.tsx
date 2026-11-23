import Link from 'next/link';

import { BossMenu } from './BossMenu';

/**
 * 上の暗い帯 (Figma 13 `135:419`)。サイト名と「管理」の印、右に BOSS のメニュー (F-5)。
 * ログイン前と権限の無い画面では、BOSS を出さない (F-1〜F-3)
 */
export function AdminBar({ email }: { email?: string | null }) {
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? 'サイト';
  return (
    <header className="flex items-center justify-between bg-bar px-4 py-3.5">
      <Link href="/" className="flex items-center gap-2">
        <span className="font-display text-lg font-bold text-white">{siteName}</span>
        <span className="rounded bg-bar-chip px-1.5 py-0.5 text-[11px] font-bold text-white">管理</span>
      </Link>
      {email !== undefined && <BossMenu email={email} />}
    </header>
  );
}
