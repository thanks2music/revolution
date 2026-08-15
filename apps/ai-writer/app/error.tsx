/**
 * Error Boundary (管理 UI 用)
 *
 * これまで ai-writer には error boundary が一切なく、Server Component が throw すると
 * 管理画面が白画面になっていた。Sentry 導入に合わせて最小構成で追加する。
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error
 */

'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    // 開発時の利便性のためコンソールにも残す
    console.error('Error boundary caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">エラーが発生しました</h1>
        <p className="text-sm text-gray-600">
          管理画面の処理中に予期しないエラーが発生しました。
        </p>

        {process.env.NODE_ENV === 'development' && (
          <pre className="p-4 bg-gray-100 rounded-md text-left text-xs text-red-600 font-mono whitespace-pre-wrap break-all">
            {error.message}
          </pre>
        )}

        {error.digest && <p className="text-xs text-gray-500">Error ID: {error.digest}</p>}

        <button
          onClick={reset}
          className="w-full py-3 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
        >
          もう一度試す
        </button>
      </div>
    </div>
  );
}
