/**
 * 404 Not Found Page
 * Next.js 14 App Router のカスタム404ページ
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/not-found
 */

import Link from 'next/link';
import type { Metadata } from 'next';

// SEO: 404ページは検索エンジンにインデックスさせない
export const metadata: Metadata = {
  title: '404 - ページが見つかりません',
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          {/* 404アイコン */}
          <div className="mb-6">
            <span className="text-9xl font-extrabold text-indigo-600">404</span>
          </div>

          {/* タイトル */}
          <h1 className="mt-2 text-3xl font-extrabold text-gray-900">
            ページが見つかりません
          </h1>

          {/* 説明 */}
          <p className="mt-4 text-base text-gray-600">
            お探しのページは削除されたか、
            <br />
            URLが変更された可能性があります。
          </p>
        </div>

        {/* アクションボタン */}
        <div className="space-y-3">
          {/* ホームへ戻るリンク */}
          <Link
            href="/"
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200"
          >
            ホームに戻る
          </Link>
        </div>

        {/* よく見られるページへのリンク */}
        <div className="mt-8">
          <h2 className="text-sm font-medium text-gray-900 mb-3">
            よく見られるページ
          </h2>
          <nav className="space-y-2">
            <Link
              href="/"
              className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors duration-200"
            >
              トップページ
            </Link>
            <Link
              href="/#"
              className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors duration-200"
            >
              記事一覧
            </Link>
            <Link
              href="/#"
              className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors duration-200"
            >
              カテゴリ一覧
            </Link>
          </nav>
        </div>

        {/* サポート情報 */}
        <p className="mt-6 text-center text-xs text-gray-500">
          お探しのページが見つからない場合は、
          <Link href="/" className="text-indigo-600 hover:text-indigo-500">
            お問い合わせ
          </Link>
          ください。
        </p>
      </div>
    </div>
  );
}
