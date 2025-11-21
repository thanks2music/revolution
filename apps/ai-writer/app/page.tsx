'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth/auth-context';
import { LogoutButton } from '../components/ui/logout-button';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // 未認証ユーザーをログインページにリダイレクト
  useEffect(() => {
    if (!loading && !user) {
      console.log('[Home] No authenticated user, redirecting to login');
      router.push('/login');
    }
  }, [loading, user, router]);

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

  // 認証されていない場合は何も表示しない（リダイレクト中）
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">AI Writer</h1>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg bg-white p-8 shadow">
          <h2 className="text-2xl font-semibold text-gray-900">Discovery 管理画面</h2>
          <p className="mt-2 text-gray-600">ようこそ、{user?.email} さん</p>

          <h3 className="mt-8 text-xl font-semibold text-gray-700">MDX版 (JAMstack構成)</h3>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <a
              href="/rss-feeds"
              className="rounded-lg border p-4 transition-colors hover:bg-gray-50"
            >
              <h3 className="font-semibold">RSS管理</h3>
              <p className="mt-2 text-sm text-gray-600">RSS feedsの登録と管理</p>
            </a>
            <a
              href="/debug-rss-mdx"
              className="rounded-lg border border-blue-200 bg-blue-50 p-4 transition-colors hover:bg-blue-100"
            >
              <h3 className="font-semibold text-blue-900">🔧 手動デバッグ (MDX版)</h3>
              <p className="mt-2 text-sm text-blue-700">
                RSS → 記事生成 → GitHub PRフローのチェック
              </p>
            </a>
            <div className="rounded-lg border p-4 opacity-50">
              <h3 className="font-semibold">記事一覧</h3>
              <p className="mt-2 text-sm text-gray-600">発見された記事の確認（準備中）</p>
            </div>
            <div className="rounded-lg border p-4 opacity-50">
              <h3 className="font-semibold">設定</h3>
              <p className="mt-2 text-sm text-gray-600">システム設定の管理（準備中）</p>
            </div>
          </div>

          <h3 className="mt-8 text-xl font-semibold text-gray-700">
            Headless WordPress版 (レガシー版)
          </h3>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <a
              href="/debug-rss"
              className="rounded-lg border border-blue-200 bg-blue-50 p-4 transition-colors hover:bg-blue-100"
            >
              <h3 className="font-semibold text-blue-900">
                🔧 手動デバッグ (Headless WordPress版)
              </h3>
              <p className="mt-2 text-sm text-blue-700">RSSチェックと記事生成のテスト</p>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
