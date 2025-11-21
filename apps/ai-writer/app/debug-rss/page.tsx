'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../lib/auth/auth-context';
import type { RssFeed } from '../../lib/types/rss-feed';
import type { RssArticleEntry } from '../../lib/types/rss-article';

interface RemainingArticle {
  title: string;
  link: string;
  description?: string;
}

interface ArticleProgress {
  step: number;
  totalSteps: number;
  message: string;
  detail?: string;
}

interface GeneratedArticleResult {
  success: boolean;
  article?: {
    title: string;
    content: string;
    excerpt: string;
    slug: string;
    categories: string[];
    tags: string[];
    metadata: {
      wordCount: number;
      generatedAt: string;
    };
  };
  wordpress?: {
    postId: string;
    databaseId: number;
    postUrl: string;
    categories: Array<{ id: string; name: string }>;
    tags: Array<{ id: string; name: string }>;
  };
  error?: string;
  remainingArticles?: RemainingArticle[];
  feedId?: string;
  feedTitle?: string;
}

export default function DebugRssPage() {
  const { user, loading: authLoading } = useAuth();
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingFeedId, setGeneratingFeedId] = useState<string | null>(null);
  const [articleProgress, setArticleProgress] = useState<ArticleProgress | null>(null);
  const [generatedResults, setGeneratedResults] = useState<GeneratedArticleResult[]>([]);
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

  const handleGenerateFromFeed = async (feedId: string, feedTitle: string) => {
    try {
      setError(null);
      setGeneratingFeedId(feedId);
      setArticleProgress({ step: 0, totalSteps: 5, message: '開始中...' });

      // 進捗表示エリアにスクロール
      setTimeout(() => {
        progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);

      const response = await fetch('/api/debug/generate-from-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedId }),
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

              if (data.done) {
                if (data.success) {
                  if (data.noNewArticles) {
                    setError('新しい記事はありません。すべての記事が生成済みです。');
                  } else {
                    const result: GeneratedArticleResult = {
                      success: true,
                      article: data.article,
                      wordpress: data.wordpress,
                      remainingArticles: data.remainingArticles || [],
                      feedId,
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
                  }
                } else {
                  setError(data.error || 'Failed to generate article');
                }
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
              🔧 RSS手動デバッグ (Headless WordPress版)
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              RSSフィードから記事を取得し、Claude APIで記事生成をテストします
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
                    onClick={() => handleGenerateFromFeed(feed.id, feed.title || feed.url)}
                    disabled={generatingFeedId === feed.id}
                    className="ml-4 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {generatingFeedId === feed.id ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                        生成中...
                      </span>
                    ) : (
                      'RSSから記事生成'
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
            <h2 className="mb-4 text-lg font-semibold text-blue-900">記事生成中</h2>
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
              生成された記事 ({generatedResults.length}件)
            </h2>
            <div className="space-y-6">
              {generatedResults.map((result, index) => (
                <GeneratedArticleDisplay
                  key={index}
                  result={result}
                  onGenerateNext={handleGenerateFromFeed}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function GeneratedArticleDisplay({
  result,
  onGenerateNext,
}: {
  result: GeneratedArticleResult;
  onGenerateNext: (feedId: string, feedTitle: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!result.success) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h3 className="font-semibold text-red-900">生成失敗</h3>
        <p className="mt-2 text-sm text-red-600">エラー: {result.error}</p>
      </div>
    );
  }

  const { article, wordpress } = result;

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-green-900">✅ {article?.title}</h3>
          {result.feedTitle && (
            <p className="mt-1 text-sm text-green-700">フィード: {result.feedTitle}</p>
          )}
        </div>
        {wordpress?.databaseId && (
          <a
            href={`http://localhost:4444/?p=${wordpress.databaseId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
          >
            WordPressで確認
          </a>
        )}
      </div>

      {/* Metadata */}
      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg bg-white p-4 md:grid-cols-5">
        <div>
          <p className="text-xs text-gray-500">WordPress ID</p>
          <p className="font-mono text-sm font-medium">{wordpress?.databaseId || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">GraphQL Global ID</p>
          <p className="font-mono text-xs font-medium truncate">{wordpress?.postId || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">文字数</p>
          <p className="font-mono text-sm font-medium">{article?.metadata.wordCount}文字</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Slug</p>
          <p className="font-mono text-sm font-medium">{article?.slug}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">生成日時</p>
          <p className="font-mono text-sm font-medium">
            {article?.metadata.generatedAt
              ? new Date(article.metadata.generatedAt).toLocaleString('ja-JP')
              : 'N/A'}
          </p>
        </div>
      </div>

      {/* Categories and Tags */}
      <div className="mb-4 rounded-lg bg-white p-4">
        <div className="mb-2">
          <p className="text-xs text-gray-500">カテゴリ</p>
          {wordpress?.categories && wordpress.categories.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {wordpress.categories.map(cat => (
                <span
                  key={cat.id}
                  className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800"
                >
                  {cat.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-400">カテゴリなし</p>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500">タグ</p>
          {wordpress?.tags && wordpress.tags.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {wordpress.tags.map(tag => (
                <span
                  key={tag.id}
                  className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-800"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-400">タグなし</p>
          )}
        </div>
      </div>

      {/* Excerpt */}
      {article?.excerpt && (
        <div className="mb-4 rounded-lg bg-white p-4">
          <p className="text-xs text-gray-500">抜粋</p>
          <p className="mt-1 text-sm text-gray-700">{article.excerpt}</p>
        </div>
      )}

      {/* Content (Toggle) */}
      {article?.content && (
        <div className="mb-4 rounded-lg bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">本文</p>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {isExpanded ? '▲ 閉じる' : '▼ 開く'}
            </button>
          </div>
          {isExpanded ? (
            <div className="prose prose-sm mt-2 max-w-none">
              <div dangerouslySetInnerHTML={{ __html: article.content }} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-600 line-clamp-3">
              {article.content.replace(/<[^>]*>/g, '').substring(0, 200)}...
            </p>
          )}
        </div>
      )}

      {/* Next Article Confirmation */}
      {result.remainingArticles && result.remainingArticles.length > 0 && result.feedId && (
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
          <div className="mb-3">
            <h4 className="font-semibold text-blue-900">次の記事</h4>
            <p className="mt-1 text-sm text-blue-700">まだ生成していない記事があります：</p>
          </div>
          <div className="mb-3 rounded-lg bg-white p-3">
            <h5 className="font-medium text-gray-900 text-sm">
              {result.remainingArticles[0].title}
            </h5>
            {result.remainingArticles[0].description && (
              <p className="mt-1 text-xs text-gray-600 line-clamp-2">
                {result.remainingArticles[0].description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onGenerateNext(result.feedId!, result.feedTitle || '')}
              className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              続けて生成する
            </button>
            <button
              className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => {
                // 確認UIを非表示にする（親の state を更新する必要があるため、一旦何もしない）
              }}
            >
              スキップ
            </button>
          </div>
          <p className="mt-2 text-xs text-blue-600">
            残り {result.remainingArticles.length} 件の未生成記事があります
          </p>
        </div>
      )}
    </div>
  );
}
