'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { mapAuthError } from '@/lib/auth/auth-error';
import { TargetService } from '@/lib/services/target.service';
import { Loading } from '@/components/loading';
import { DeleteTargetDialog } from '@/components/targets/delete-target-dialog';
import { TargetCreateForm } from '@/components/targets/target-create-form';
import { TargetRow } from '@/components/targets/target-row';
import { TargetRowEditor } from '@/components/targets/target-row-editor';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Target } from '@/types/target';

/**
 * 監視対象の一覧と、作成・編集・削除。
 *
 * - ページは「もっと読む」で後ろに足す (Firestore の startAfter は前に進むのが素直なため)
 * - 同時に編集できるのは 1 件だけ。編集の間は、他の 1 件のボタンと作成のフォームを止める
 * - 保存・削除の後は読み直さず、手元の配列を差し替える (`createdAt` は変わらないので順番も崩れない)
 */

const PAGE_SIZE = 20;

export function TargetList() {
  const [items, setItems] = useState<Target[]>([]);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // StrictMode で effect が 2 回走っても、最初の読み込みは 1 回にする
  const initialized = useRef(false);

  const load = useCallback(async (cursorCreatedAt?: number) => {
    setLoading(true);
    setError(null);

    try {
      const page = await TargetService.listPage({ limit: PAGE_SIZE, cursorCreatedAt });
      setItems(previous =>
        cursorCreatedAt === undefined ? page.items : [...previous, ...page.items]
      );
      setHasMore(page.hasMore);
      setCursor(page.nextCursorCreatedAt ?? undefined);
    } catch (caught) {
      setError(mapAuthError(caught)?.message ?? '監視対象を読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    setDeleteError(null);

    try {
      await TargetService.remove(deleteTarget.id);
      setItems(previous => previous.filter(item => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (caught) {
      setDeleteError(mapAuthError(caught)?.message ?? '監視対象を削除できませんでした。');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  if (loading && items.length === 0) {
    return <Loading label="監視対象を読み込んでいます" />;
  }

  return (
    <section aria-labelledby="target-list-heading" className="grid gap-4">
      <h2 id="target-list-heading" className="text-xl font-bold">
        監視対象
      </h2>

      {editingId === null ? (
        <div>
          <TargetCreateForm onCreated={created => setItems(previous => [created, ...previous])} />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>読み込めませんでした</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
              もう一度読み込む
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {deleteError ? (
        <Alert variant="destructive">
          <AlertTitle>削除できませんでした</AlertTitle>
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}

      {!error && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">監視対象はまだありません。</p>
      ) : null}

      {items.length > 0 ? (
        <ul aria-label="監視対象の一覧" className="divide-y rounded-lg border">
          {items.map(target =>
            target.id === editingId ? (
              <TargetRowEditor
                key={target.id}
                target={target}
                onCancel={() => setEditingId(null)}
                onSaved={updated => {
                  setItems(previous =>
                    previous.map(item => (item.id === updated.id ? updated : item))
                  );
                  setEditingId(null);
                }}
              />
            ) : (
              <TargetRow
                key={target.id}
                target={target}
                actionsDisabled={editingId !== null}
                onEdit={() => setEditingId(target.id)}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleteTarget(target);
                }}
              />
            )
          )}
        </ul>
      ) : null}

      {hasMore ? (
        <div>
          <Button variant="outline" disabled={loading} onClick={() => void load(cursor)}>
            {loading ? '読み込んでいます…' : 'もっと読む'}
          </Button>
        </div>
      ) : null}

      <DeleteTargetDialog
        title={deleteTarget?.title ?? null}
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
