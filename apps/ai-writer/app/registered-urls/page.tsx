'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { describeRegisteredUrlStatus, isAwaitingRetry, type StatusTone } from '../../lib/scheduled/registered-url-status';
import type { RegisteredUrlAttemptView, RegisteredUrlView } from '../../lib/types/registered-url';

const TONE_CLASS: Record<StatusTone, string> = {
  pending: 'border-gray-300 bg-gray-100 text-gray-800',
  success: 'border-green-300 bg-green-100 text-green-800',
  neutral: 'border-gray-300 bg-white text-gray-700',
  waiting: 'border-yellow-300 bg-yellow-100 text-yellow-800',
  error: 'border-red-300 bg-red-100 text-red-800',
};

function StatusCell({ attempt }: { attempt?: RegisteredUrlAttemptView }) {
  const status = describeRegisteredUrlStatus(attempt);
  return (
    <div>
      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${TONE_CLASS[status.tone]}`}>
        {status.label}
      </span>
      {status.prUrl && (
        <div className="mt-1 text-xs">
          <a href={status.prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            PR を開く
          </a>
        </div>
      )}
      {status.details.map(detail => (
        <div key={detail} className="mt-1 break-all text-xs text-gray-500">
          {detail}
        </div>
      ))}
    </div>
  );
}

export default function RegisteredUrlsPage() {
  const [entries, setEntries] = useState<RegisteredUrlView[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; attempt?: RegisteredUrlAttemptView } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadEntries = async () => {
    try {
      const response = await fetch('/api/registered-urls');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '登録 URL を読み込めませんでした');
      // The newest registration first; the scheduled run tries them oldest first
      setEntries([...(data.urls as RegisteredUrlView[])].reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録 URL を読み込めませんでした');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/registered-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (response.status === 201) {
        setUrl('');
        setNotice({ message: '登録しました。次の定期実行で最初に試します。' });
        await loadEntries();
      } else if (data.reason === 'already-attempted') {
        setNotice({ message: 'この URL は既に試しているため、登録しませんでした。', attempt: data.attempt });
      } else if (data.reason === 'already-registered') {
        setNotice({ message: 'この URL は既に登録されています。' });
      } else {
        setError(data.error || '登録できませんでした');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録できませんでした');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (entry: RegisteredUrlView) => {
    if (removingId) return;
    const message = isAwaitingRetry(entry.attempt?.status)
      ? 'この登録を削除しますか？ 試し直しも打ち切ります。'
      : 'この登録を削除しますか？';
    if (!confirm(message)) return;

    setError(null);
    setNotice(null);
    setRemovingId(entry.id);
    try {
      const response = await fetch(`/api/registered-urls/${entry.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '削除できませんでした');
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除できませんでした');
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900"></div>
          <p className="mt-4 text-sm text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="text-sm text-gray-600 hover:text-gray-900">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">URL 登録</h1>
          <p className="mt-1 text-sm text-gray-600">
            登録した URL は、次の定期実行で RSS の記事より先に試します。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-md bg-blue-50 p-4" role="status">
            <p className="text-sm text-blue-900">{notice.message}</p>
            {notice.attempt && (
              <div className="mt-2">
                <StatusCell attempt={notice.attempt} />
              </div>
            )}
          </div>
        )}

        <div className="mb-8 rounded-lg bg-white p-6 shadow">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="registered-url" className="block text-sm font-medium text-gray-700">
                URL <span className="text-red-500">*</span>
              </label>
              <input
                id="registered-url"
                type="url"
                required
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="https://example.com/event"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? '登録中...' : '登録'}
            </button>
          </form>
        </div>

        <div className="rounded-lg bg-white shadow">
          {entries.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500">登録されている URL はありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      タイトル / URL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      結果
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      登録
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {entries.map(entry => (
                    <tr key={entry.id}>
                      <td className="max-w-md px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          {entry.attempt?.title || 'タイトル未取得'}
                        </div>
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-sm text-blue-600 hover:underline"
                        >
                          {entry.url}
                        </a>
                      </td>
                      <td className="max-w-sm px-6 py-4">
                        <StatusCell attempt={entry.attempt} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div>{new Date(entry.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</div>
                        <div className="text-xs text-gray-400">{entry.createdBy}</div>
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        <button
                          type="button"
                          onClick={() => handleRemove(entry)}
                          disabled={removingId !== null}
                          className="text-red-600 hover:text-red-900 disabled:cursor-wait disabled:opacity-60"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
