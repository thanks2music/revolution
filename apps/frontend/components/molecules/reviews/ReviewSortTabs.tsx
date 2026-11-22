'use client';

/**
 * 口コミの並び替え (新着順 / 参考になった順、Figma #3 `83:81`、one-more-time #165)。
 * 2 つの一覧はサーバーで描いて渡す (開催のページは ISR のまま。並び替えはブラウザで切り替えるだけ)。
 */

import { useState, type ReactNode } from 'react';

const TABS = [
  { key: 'latest', label: '新着順' },
  { key: 'helpful', label: '参考になった順' },
] as const;

export function ReviewSortTabs(props: { latest: ReactNode; helpful: ReactNode }) {
  const [sort, setSort] = useState<(typeof TABS)[number]['key']>('latest');
  return (
    <>
      <div role="group" aria-label="並び替え" className="flex gap-1.5">
        {TABS.map(tab => {
          const selected = sort === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setSort(tab.key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                selected
                  ? 'border-primary-600 bg-primary-50 font-bold text-primary-700'
                  : 'border-(--line-soft) bg-white text-ink-body hover:bg-muted'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {sort === 'latest' ? props.latest : props.helpful}
    </>
  );
}
