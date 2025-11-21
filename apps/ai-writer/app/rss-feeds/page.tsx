'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/auth/auth-context';
import { RssFeedService } from '../../lib/services/rss-feed.service';
import type { RssFeed, CreateRssFeedInput, ValidationConfig } from '../../lib/types/rss-feed';
import { VALIDATION_PRESETS } from '../../lib/types/rss-feed';

export default function RssFeedsPage() {
  const { user } = useAuth();
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFeed, setEditingFeed] = useState<RssFeed | null>(null);
  const [formData, setFormData] = useState<CreateRssFeedInput>({
    url: '',
    title: '',
    description: '',
    siteUrl: '',
    isActive: true,
    validationConfig: undefined,
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 妥当性設定関連のstate
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [showValidationConfig, setShowValidationConfig] = useState(true);
  const [customKeywords, setCustomKeywords] = useState<string>('');

  useEffect(() => {
    loadFeeds();
  }, []);

  // プリセット変更時の処理
  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = VALIDATION_PRESETS.find(p => p.id === presetId);

    if (preset) {
      setFormData(prev => ({
        ...prev,
        validationConfig: preset.config
      }));
      setCustomKeywords(preset.config.keywords.join(', '));
      setShowValidationConfig(presetId === 'custom');
    } else if (presetId === 'custom') {
      setShowValidationConfig(true);
      setFormData(prev => ({
        ...prev,
        validationConfig: {
          keywords: [],
          keywordLogic: 'OR',
          requireJapanese: true,
          minScore: 70,
          isEnabled: true
        }
      }));
      setCustomKeywords('');
    }
  };

  // カスタムキーワード変更時の処理
  const handleCustomKeywordsChange = (value: string) => {
    setCustomKeywords(value);
    const keywords = value.split(',').map(k => k.trim()).filter(k => k);
    setFormData(prev => ({
      ...prev,
      validationConfig: prev.validationConfig ? {
        ...prev.validationConfig,
        keywords
      } : undefined
    }));
  };

  const loadFeeds = async () => {
    console.log('=== Loading Feeds ===');
    try {
      setLoading(true);

      // Use API endpoint instead of direct Firestore access
      const response = await fetch('/api/rss-feeds?activeOnly=false');
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to load feeds');
      }

      console.log('Feeds loaded:', data.feeds.length, 'items');
      setFeeds(data.feeds);
    } catch (err) {
      console.error('Failed to load feeds:', err);
      setError(err instanceof Error ? err.message : 'Failed to load feeds');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('=== Form Submit Start ===');
    console.log('User:', user);
    console.log('Form Data:', formData);
    console.log('Edit Mode:', !!editingFeed);

    if (!user) {
      console.error('User is not authenticated');
      setError('ユーザーが認証されていません');
      return;
    }

    if (!formData.url.trim()) {
      console.error('URL is empty');
      setError('RSS URLを入力してください');
      return;
    }

    try {
      setError(null);
      setIsSubmitting(true);

      if (editingFeed) {
        // 編集モード
        console.log('Updating feed...');
        await RssFeedService.updateFeed(editingFeed.id, {
          url: formData.url,
          title: formData.title,
          description: formData.description,
          siteUrl: formData.siteUrl,
          isActive: formData.isActive,
        });
        console.log('Feed updated successfully');
      } else {
        // 新規作成モード
        console.log('Creating feed...');
        const result = await RssFeedService.createFeed(formData, user.uid);
        console.log('Feed created successfully:', result);
      }

      // フォームリセット
      setFormData({ url: '', title: '', description: '', siteUrl: '', isActive: true, validationConfig: undefined });
      setShowForm(false);
      setEditingFeed(null);
      setSelectedPreset('');
      setShowValidationConfig(false);
      setCustomKeywords('');

      console.log('Reloading feeds...');
      await loadFeeds();
      console.log('=== Form Submit Complete ===');

    } catch (err) {
      console.error('=== Form Submit Error ===');
      console.error('Error type:', err?.constructor?.name);
      console.error('Error message:', err);
      console.error('Error stack:', err instanceof Error ? err.stack : 'No stack');

      const errorMessage = err instanceof Error ? err.message : editingFeed ? 'Failed to update feed' : 'Failed to create feed';
      setError(`エラー: ${errorMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このRSSフィードを削除しますか？')) return;

    try {
      await RssFeedService.deleteFeed(id);
      await loadFeeds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete feed');
    }
  };

  const handleToggleActive = async (feed: RssFeed) => {
    try {
      await RssFeedService.updateFeed(feed.id, { isActive: !feed.isActive });
      await loadFeeds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feed');
    }
  };

  const handleEdit = (feed: RssFeed) => {
    setEditingFeed(feed);
    setFormData({
      url: feed.url,
      title: feed.title || '',
      description: feed.description || '',
      siteUrl: feed.siteUrl || '',
      isActive: feed.isActive,
      validationConfig: feed.validationConfig,
    });

    // プリセット設定の復元
    if (feed.validationConfig) {
      const matchingPreset = VALIDATION_PRESETS.find(preset =>
        JSON.stringify(preset.config) === JSON.stringify(feed.validationConfig)
      );

      if (matchingPreset) {
        setSelectedPreset(matchingPreset.id);
        setShowValidationConfig(false);
      } else {
        setSelectedPreset('custom');
        setShowValidationConfig(true);
      }
      setCustomKeywords(feed.validationConfig.keywords.join(', '));
    } else {
      setSelectedPreset('');
      setShowValidationConfig(false);
      setCustomKeywords('');
    }

    setShowForm(true);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingFeed(null);
    setFormData({ url: '', title: '', description: '', siteUrl: '', isActive: true, validationConfig: undefined });
    setShowForm(false);
    setError(null);
    setSelectedPreset('');
    setShowValidationConfig(false);
    setCustomKeywords('');
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
          <div className="flex items-center justify-between">
            <div>
              <a href="/" className="text-sm text-gray-600 hover:text-gray-900">
                ← ダッシュボードに戻る
              </a>
              <h1 className="mt-2 text-2xl font-bold text-gray-900">RSS フィード管理</h1>
            </div>
            <button
              onClick={() => {
                if (showForm && editingFeed) {
                  handleCancelEdit();
                } else if (showForm) {
                  setShowForm(false);
                } else {
                  setEditingFeed(null);
                  setFormData({
                    url: '',
                    title: '',
                    description: '',
                    siteUrl: '',
                    isActive: true,
                    validationConfig: {
                      keywords: [],
                      keywordLogic: 'OR',
                      requireJapanese: true,
                      minScore: 70,
                      isEnabled: true
                    }
                  });
                  setSelectedPreset('custom');
                  setShowValidationConfig(true);
                  setCustomKeywords('');
                  setShowForm(true);
                  setError(null);
                }
              }}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {showForm ? 'キャンセル' : '+ 新規追加'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {showForm && (
          <div className="mb-8 rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold">
              {editingFeed ? 'RSSフィードを編集' : '新しいRSSフィードを追加'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  RSS URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  required
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder="https://example.com/feed.xml"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  タイトル <span className="text-xs text-gray-500">(任意)</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder="例: AI技術 最新ニュース"
                />
                <p className="mt-1 text-xs text-gray-500">
                  管理しやすい名前を付けてください。空欄の場合はURLが表示されます。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  説明 <span className="text-xs text-gray-500">(任意)</span>
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder="例: AI関連の最新ニュースを収集"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  サイトURL <span className="text-xs text-gray-500">(任意)</span>
                </label>
                <input
                  type="text"
                  value={formData.siteUrl}
                  onChange={(e) => setFormData({ ...formData, siteUrl: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder="https://example.com (Googleアラートの場合は不要)"
                />
                <p className="mt-1 text-xs text-gray-500">
                  通常のブログRSSの場合のみ入力してください。Googleアラートは空欄で構いません。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  記事妥当性設定 <span className="text-xs text-gray-500">(任意)</span>
                </label>
                <select
                  value={selectedPreset}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                >
                  <option value="">設定しない</option>
                  <option value="disabled">妥当性チェックなし（すべての記事を通す）</option>
                  <option value="custom">カスタム設定</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  記事の妥当性チェック方法を選択してください。カスタム設定では、キーワードや言語などの条件を自由に設定できます。
                </p>
              </div>

              {selectedPreset && selectedPreset !== '' && (
                <div className="rounded-md bg-gray-50 p-3">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">選択された設定</h4>
                  {selectedPreset !== 'custom' && (
                    <div className="text-xs text-gray-600">
                      {VALIDATION_PRESETS.find(p => p.id === selectedPreset)?.description}
                    </div>
                  )}
                  {formData.validationConfig && (
                    <div className="mt-2 space-y-1 text-xs text-gray-600">
                      <div>キーワード: {formData.validationConfig.keywords.length > 0 ? formData.validationConfig.keywords.join(', ') : 'なし'}</div>
                      <div>キーワードロジック: {formData.validationConfig.keywordLogic}</div>
                      <div>日本語必須: {formData.validationConfig.requireJapanese ? 'はい' : 'いいえ'}</div>
                      <div>最低スコア: {formData.validationConfig.minScore}%</div>
                      <div>妥当性チェック: {formData.validationConfig.isEnabled ? '有効' : '無効'}</div>
                    </div>
                  )}
                </div>
              )}

              {showValidationConfig && (
                <div className="space-y-4 rounded-md border border-gray-200 p-4">
                  <h4 className="text-sm font-medium text-gray-700">カスタム妥当性設定</h4>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      キーワード <span className="text-xs text-gray-500">(カンマ区切り)</span>
                    </label>
                    <input
                      type="text"
                      value={customKeywords}
                      onChange={(e) => handleCustomKeywordsChange(e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      placeholder="例: キーワード1, キーワード2, キーワード3"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      記事に含まれるべきキーワードを入力してください。空欄の場合はキーワードチェックをスキップします。
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      キーワードマッチング
                    </label>
                    <select
                      value={formData.validationConfig?.keywordLogic || 'OR'}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        validationConfig: prev.validationConfig ? {
                          ...prev.validationConfig,
                          keywordLogic: e.target.value as 'AND' | 'OR'
                        } : undefined
                      }))}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    >
                      <option value="OR">いずれか一つのキーワードがあればOK</option>
                      <option value="AND">すべてのキーワードが必要</option>
                    </select>
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="requireJapanese"
                      checked={formData.validationConfig?.requireJapanese ?? true}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        validationConfig: prev.validationConfig ? {
                          ...prev.validationConfig,
                          requireJapanese: e.target.checked
                        } : undefined
                      }))}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    <label htmlFor="requireJapanese" className="ml-2 text-sm text-gray-700">
                      日本語記事を優先する
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      最低妥当性スコア: {formData.validationConfig?.minScore || 70}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={formData.validationConfig?.minScore || 70}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        validationConfig: prev.validationConfig ? {
                          ...prev.validationConfig,
                          minScore: parseInt(e.target.value)
                        } : undefined
                      }))}
                      className="mt-1 block w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      この値以上のスコアを持つ記事のみが妥当と判定されます。
                    </p>
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="isEnabled"
                      checked={formData.validationConfig?.isEnabled ?? true}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        validationConfig: prev.validationConfig ? {
                          ...prev.validationConfig,
                          isEnabled: e.target.checked
                        } : undefined
                      }))}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    <label htmlFor="isEnabled" className="ml-2 text-sm text-gray-700">
                      妥当性チェックを有効にする
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-8">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting
                    ? (editingFeed ? '更新中...' : '追加中...')
                    : (editingFeed ? '更新' : '追加')
                  }
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={isSubmitting}
                  className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                >
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="rounded-lg bg-white shadow">
          {feeds.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500">登録されているRSSフィードはありません</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 text-sm text-gray-900 underline"
              >
                最初のフィードを追加する
              </button>
            </div>
          ) : (
            <div className="overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      タイトル / URL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      ステータス
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      登録日
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {feeds.map((feed) => (
                    <tr key={feed.id}>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          {feed.title || 'タイトルなし'}
                        </div>
                        <a
                          href={feed.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          {feed.url}
                        </a>
                        {feed.description && (
                          <div className="mt-1 text-xs text-gray-400">{feed.description}</div>
                        )}
                        {feed.siteUrl && (
                          <div className="mt-1 text-xs text-gray-400">
                            サイト: <a href={feed.siteUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{feed.siteUrl}</a>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggleActive(feed)}
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            feed.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {feed.isActive ? '有効' : '無効'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(feed.createdAt).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => handleEdit(feed)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(feed.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            削除
                          </button>
                        </div>
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
