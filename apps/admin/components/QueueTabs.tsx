import Link from 'next/link';

type Tab = 'queue' | 'reports';

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: 'queue', href: '/', label: 'AI が迷った口コミ' },
  { tab: 'reports', href: '/reports', label: '通報' },
];

/** 一覧のタブ (Figma 13 `135:425`・16-PC `88:439`)。確認待ち (AI が迷った口コミ) と通報 */
export function QueueTabs({ active, counts }: { active: Tab; counts: Record<Tab, number> }) {
  return (
    <nav className="flex gap-5 border-b border-line-soft px-4" aria-label="一覧">
      {TABS.map(({ tab, href, label }) => {
        const current = tab === active;
        const count = counts[tab];
        return (
          <Link
            key={tab}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={`flex items-center gap-1.5 pt-3.5 pb-3 text-sm font-bold ${
              current ? 'border-b-2 border-bar text-ink-strong' : 'text-ink-muted'
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`rounded-full px-[7px] py-px text-[11px] font-bold ${
                  current ? 'bg-danger text-white' : 'bg-line-soft text-ink-body'
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
