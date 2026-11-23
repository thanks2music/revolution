import { Suspense } from 'react';

import { Loading } from '@/components/loading';
import { SnapshotPanel } from '@/components/snapshots/snapshot-panel';

/**
 * 監視対象 1 件の履歴 (`/detail?targetId=<id>`)。静的な書き出しで out/detail.html になり、
 * Hosting の rewrites が `/detail` をこれに向ける。
 *
 * useSearchParams を使う SnapshotPanel を Suspense で包む (包まないと静的な書き出しのビルドが失敗する)。
 * このファイルには 'use client' を付けない (付けると Suspense の外までクライアントで描くことになる)。
 */
export default function DetailPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Suspense fallback={<Loading label="履歴を読み込んでいます" />}>
        <SnapshotPanel />
      </Suspense>
    </main>
  );
}
