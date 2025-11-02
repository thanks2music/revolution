/**
 * Global Error Boundary
 * Next.js 14 App Router のエラーバウンダリ
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error
 */

'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // エラーをコンソールにログ出力（開発環境でのデバッグ用）
    console.error('Error boundary caught:', error);
  }, [error]);

  // リトライ後にボタンへフォーカス移動（アクセシビリティ）
  const handleReset = () => {
    reset();
    // リセット後、ボタンにフォーカスを戻す
    setTimeout(() => {
      retryButtonRef.current?.focus();
    }, 100);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          {/* エラーアイコン */}
          <svg
            className="mx-auto h-16 w-16 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>

          {/* タイトル */}
          <h1 className="mt-6 text-3xl font-extrabold text-gray-900">
            エラーが発生しました
          </h1>

          {/* エラーメッセージ */}
          <p className="mt-2 text-sm text-gray-600">
            申し訳ございません。予期しないエラーが発生しました。
          </p>

          {/* 開発環境でのみエラー詳細を表示 */}
          {process.env.NODE_ENV === 'development' && (
            <details className="mt-4 text-left">
              <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                エラー詳細を表示
              </summary>
              <div className="mt-2 p-4 bg-gray-100 rounded-md overflow-auto">
                <p className="text-xs text-red-600 font-mono break-all">
                  {error.message}
                </p>
                {error.digest && (
                  <p className="mt-2 text-xs text-gray-500">
                    Error ID: {error.digest}
                  </p>
                )}
              </div>
            </details>
          )}
        </div>

        {/* アクションボタン */}
        <div className="space-y-3">
          {/* リトライボタン */}
          <button
            ref={retryButtonRef}
            onClick={handleReset}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200"
          >
            もう一度試す
          </button>

          {/* ホームへ戻るリンク */}
          <Link
            href="/"
            className="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200"
          >
            ホームに戻る
          </Link>
        </div>

        {/* サポート情報 */}
        <p className="mt-6 text-center text-xs text-gray-500">
          問題が解決しない場合は、
          <Link href="/" className="text-indigo-600 hover:text-indigo-500">
            お問い合わせ
          </Link>
          ください。
        </p>
      </div>
    </div>
  );
}
