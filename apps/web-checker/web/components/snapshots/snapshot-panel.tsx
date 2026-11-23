'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { mapAuthError } from '@/lib/auth/auth-error';
import { SnapshotService } from '@/lib/services/snapshot.service';
import { TargetService } from '@/lib/services/target.service';
import { isValidTargetId } from '@/lib/target/target-id';
import { formatJst } from '@/lib/format-date';
import { Loading } from '@/components/loading';
import { SnapshotCard } from '@/components/snapshots/snapshot-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Snapshot } from '@/types/snapshot';
import type { Target } from '@/types/target';

/**
 * 監視対象 1 件の履歴。`?targetId=` で対象を受ける (Slack の通知の「履歴を見る」から直接開かれる)。
 *
 * useSearchParams を使うので、静的な書き出しでは Suspense の内側に置く (app/(protected)/detail/page.tsx)。
 */

const PAGE_SIZE = 10;

export function SnapshotPanel() {
  const searchParams = useSearchParams();
  const targetId = searchParams.get('targetId');
  const valid = isValidTargetId(targetId);

  const [target, setTarget] = useState<Target | null>(null);
  const [items, setItems] = useState<Snapshot[]>([]);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(valid);
  const [error, setError] = useState<string | null>(null);

  const initialized = useRef(false);

  const loadPage = useCallback(async (id: string, cursorTime?: number) => {
    setLoading(true);
    setError(null);

    try {
      const page = await SnapshotService.listPage(id, { limit: PAGE_SIZE, cursorTime });
      setItems(previous => (cursorTime === undefined ? page.items : [...previous, ...page.items]));
      setHasMore(page.hasMore);
      setCursor(page.nextCursorTime ?? undefined);
    } catch (caught) {
      setError(mapAuthError(caught)?.message ?? '履歴を読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!valid || initialized.current) return;
    initialized.current = true;

    void loadPage(targetId);

    // 見出しの監視対象。読めなくても履歴は出したいので、エラーにせず見出しを省く
    TargetService.get(targetId)
      .then(setTarget)
      .catch(() => setTarget(null));
  }, [valid, targetId, loadPage]);

  if (!valid) {
    return (
      <Alert variant="destructive">
        <AlertTitle>監視対象を指定してください</AlertTitle>
        <AlertDescription>
          <p>URL の監視対象の指定が無いか、形が正しくありません。</p>
          <Link href="/">一覧に戻る</Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section aria-labelledby="snapshot-heading" className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="snapshot-heading" className="text-xl font-bold">
          履歴
        </h2>
        <Link href="/" className="text-sm underline underline-offset-3">
          一覧に戻る
        </Link>
      </div>

      {target ? (
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{target.title}</p>
          <a
            href={target.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline"
          >
            {target.url}
          </a>
          <p className="mt-1">最後に見に行った日時: {formatJst(target.checkedAt)}</p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>読み込めませんでした</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void loadPage(targetId)}
            >
              もう一度読み込む
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && items.length === 0 ? <Loading label="履歴を読み込んでいます" /> : null}

      {!loading && !error && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">履歴はまだありません。</p>
      ) : null}

      {items.length > 0 ? (
        <ul aria-label="履歴の一覧" className="grid gap-3">
          {items.map(snapshot => (
            <SnapshotCard key={snapshot.id} snapshot={snapshot} />
          ))}
        </ul>
      ) : null}

      {hasMore ? (
        <div>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void loadPage(targetId, cursor)}
          >
            {loading ? '読み込んでいます…' : 'もっと読む'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
