'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import type { RssFeed } from '@/lib/types/rss-feed';

interface ArticleProgress {
  step: number;
  totalSteps: number;
  message: string;
  detail?: string;
}

interface MdxGenerationResult {
  success: boolean;
  mdxArticle?: {
    title: string;
    filePath: string;
    slug: string;
  };
  github?: {
    prNumber: number;
    prUrl: string;
    branchName: string;
  };
  event?: {
    canonicalKey: string;
    postId: string;
    workSlug: string;
    year: number;
  };
  error?: string;
  feedId?: string;
  feedTitle?: string;
}

export default function DebugRssMdxPage() {
  const { user, loading: authLoading } = useAuth();
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingFeedId, setGeneratingFeedId] = useState<string | null>(null);
  const [articleProgress, setArticleProgress] = useState<ArticleProgress | null>(null);
  const [generatedResults, setGeneratedResults] = useState<MdxGenerationResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // スクロール制御用のref
  const progressRef = useRef<HTMLDivElement>(null);
  const generatedResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && user) {
      loadFeeds();
    }
  }, [authLoading, user]);

  const loadFeeds = async () => {
    try {
      setLoading(true);

      // Use API endpoint instead of direct Firestore access
      const response = await fetch('/api/rss-feeds?activeOnly=true');
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to load feeds');
      }

      setFeeds(data.feeds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feeds');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateFromFeed = async (feedUrl: string, feedTitle: string) => {
    try {
      setError(null);
      setGeneratingFeedId(feedUrl);
      setArticleProgress({ step: 0, totalSteps: 6, message: '開始中...' });

      // 進捗表示エリアにスクロール
      setTimeout(() => {
        progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);

      const response = await fetch('/api/debug/generate-from-feed-mdx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl, itemIndex: 0 }),
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // 最後の不完全な行は次回に持ち越し
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                setError(data.error);
                setArticleProgress(null);
                break;
              }

              if (data.complete) {
                const result: MdxGenerationResult = {
                  success: data.result.success,
                  mdxArticle: data.result.mdxArticle,
                  github: data.result.github,
                  event: data.result.event,
                  feedId: feedUrl,
                  feedTitle,
                };
                setGeneratedResults(prev => [result, ...prev]);

                // 生成された記事エリアにスクロール
                setTimeout(() => {
                  generatedResultsRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                }, 300);

                setArticleProgress(null);
              } else if (data.step) {
                setArticleProgress({
                  step: data.step,
                  totalSteps: data.totalSteps,
                  message: data.message,
                  detail: data.detail,
                });
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate from feed');
      setArticleProgress(null);
    } finally {
      setGeneratingFeedId(null);
    }
  };

  if (authLoading || loading) {
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
          <div>
            <a href="/" className="text-sm text-gray-600 hover:text-gray-900">
              ← ダッシュボードに戻る
            </a>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">
              🔧 RSS手動デバッグ (MDX Pipeline版)
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              RSSフィードから記事を取得し、Claude APIでMDX記事を生成してGitHub PRを作成します
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* RSS Feed List */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold">登録済みRSSフィード</h2>

          {feeds.length === 0 ? (
            <p className="text-gray-500">アクティブなRSSフィードがありません</p>
          ) : (
            <div className="space-y-3">
              {feeds.map(feed => (
                <div
                  key={feed.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{feed.title || 'タイトルなし'}</h3>
                    <p className="text-sm text-gray-500">{feed.url}</p>
                  </div>
                  <button
                    onClick={() => handleGenerateFromFeed(feed.url, feed.title || feed.url)}
                    disabled={generatingFeedId === feed.url}
                    className="ml-4 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {generatingFeedId === feed.url ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                        生成中...
                      </span>
                    ) : (
                      'MDX記事を生成'
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Article Generation Progress */}
        {articleProgress && (
          <div ref={progressRef} className="mb-8 rounded-lg bg-blue-50 p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold text-blue-900">MDX記事生成中</h2>
            <div className="space-y-4">
              {/* Progress Bar */}
              <div className="relative">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-blue-900">{articleProgress.message}</span>
                  <span className="text-blue-700">
                    ステップ {articleProgress.step}/{articleProgress.totalSteps}
                  </span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-blue-200">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out"
                    style={{
                      width: `${(articleProgress.step / articleProgress.totalSteps) * 100}%`,
                    }}
                  ></div>
                </div>
              </div>

              {/* Detail Message */}
              {articleProgress.detail && (
                <p className="text-sm text-blue-700">{articleProgress.detail}</p>
              )}

              {/* Loading Spinner */}
              <div className="flex items-center gap-2 text-blue-600">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                <span className="text-sm">処理中...</span>
              </div>
            </div>
          </div>
        )}

        {/* Generated Articles */}
        {generatedResults.length > 0 && (
          <div ref={generatedResultsRef} className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold">
              生成されたMDX記事 ({generatedResults.length}件)
            </h2>
            <div className="space-y-6">
              {generatedResults.map((result, index) => (
                <MdxArticleDisplay key={index} result={result} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MdxArticleDisplay({ result }: { result: MdxGenerationResult }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const handleResetFirestore = async (canonicalKey: string) => {
    if (!confirm(`Firestoreのステータスをリセットしますか？\n\nCanonical Key: ${canonicalKey}\n\nこの操作により、同じイベントの記事を再生成できるようになります。`)) {
      return;
    }

    try {
      setResetting(true);
      setResetSuccess(false);

      const response = await fetch('/api/debug/reset-firestore-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonicalKey }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to reset Firestore status');
      }

      setResetSuccess(true);
      alert('✅ Firestoreステータスをリセットしました。\n\n同じ記事を再生成できます。');
    } catch (error) {
      alert(`❌ リセット失敗: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setResetting(false);
    }
  };

  if (!result.success) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-red-900">生成失敗</h3>
            <p className="mt-2 text-sm text-red-600">エラー: {result.error}</p>
          </div>
          {result.event?.canonicalKey && (
            <button
              onClick={() => handleResetFirestore(result.event!.canonicalKey)}
              disabled={resetting}
              className="ml-4 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {resetting ? 'リセット中...' : 'Firestoreリセット'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const { mdxArticle, github, event } = result;

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-green-900">✅ {mdxArticle?.title}</h3>
          {result.feedTitle && (
            <p className="mt-1 text-sm text-green-700">フィード: {result.feedTitle}</p>
          )}
        </div>
        <div className="ml-4 flex gap-2">
          {github?.prUrl && (
            <a
              href={github.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
            >
              GitHub PRで確認
            </a>
          )}
          {event?.canonicalKey && (
            <button
              onClick={() => handleResetFirestore(event.canonicalKey)}
              disabled={resetting}
              className="rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              title="Firestoreステータスをリセットして同じ記事を再生成できるようにする"
            >
              {resetting ? 'リセット中...' : '🔄 リセット'}
            </button>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg bg-white p-4 md:grid-cols-4">
        <div>
          <p className="text-xs text-gray-500">PR番号</p>
          <p className="font-mono text-sm font-medium">#{github?.prNumber || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Post ID</p>
          <p className="font-mono text-sm font-medium">{event?.postId || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Work Slug</p>
          <p className="font-mono text-sm font-medium">{event?.workSlug || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">年</p>
          <p className="font-mono text-sm font-medium">{event?.year || 'N/A'}</p>
        </div>
      </div>

      {/* Canonical Key */}
      <div className="mb-4 rounded-lg bg-white p-4">
        <p className="text-xs text-gray-500">Canonical Key</p>
        <p className="mt-1 font-mono text-sm text-gray-700">{event?.canonicalKey || 'N/A'}</p>
      </div>

      {/* File Path */}
      {mdxArticle?.filePath && (
        <div className="mb-4 rounded-lg bg-white p-4">
          <p className="text-xs text-gray-500">ファイルパス</p>
          <p className="mt-1 font-mono text-sm text-gray-700">{mdxArticle.filePath}</p>
        </div>
      )}

      {/* Branch Name */}
      {github?.branchName && (
        <div className="mb-4 rounded-lg bg-white p-4">
          <p className="text-xs text-gray-500">ブランチ名</p>
          <p className="mt-1 font-mono text-sm text-gray-700">{github.branchName}</p>
        </div>
      )}

      {/* Success Message */}
      <div className="rounded-lg border-2 border-green-200 bg-green-50 p-4">
        <div className="mb-2">
          <h4 className="font-semibold text-green-900">✅ 生成完了</h4>
          <p className="mt-1 text-sm text-green-700">
            MDX記事が生成され、GitHub PRが作成されました。
          </p>
        </div>
        <div className="rounded-lg bg-white p-3">
          <h5 className="font-medium text-gray-900 text-sm mb-2">次のステップ:</h5>
          <ol className="text-xs text-gray-700 space-y-1 list-decimal list-inside">
            <li>GitHub PRをレビュー</li>
            <li>問題なければPRをマージ</li>
            <li>ローカル環境で <code className="bg-gray-100 px-1 py-0.5 rounded">git pull</code></li>
            <li>
              <code className="bg-gray-100 px-1 py-0.5 rounded">
                pnpm --filter @revolution/frontend generate:article-index
              </code> を実行
            </li>
            <li>フロントエンドをビルドして記事を確認</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
