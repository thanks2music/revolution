'use client';

import { useState, useEffect } from 'react';
// types
import PostOnListType from '../../types/PostOnListType';
// hooks
import usePostListSwr from '../../hooks/swr/usePostListSwr';
// components
import PostBox from '../molecules/PostBox';

interface PostListClientProps {
  staticPostList: PostOnListType[];
  categoryId?: number;
}

const PostListClient = ({ staticPostList, categoryId }: PostListClientProps) => {
  const [mounted, setMounted] = useState(false);
  
  // ハイドレーション完了後にSWRを有効化
  useEffect(() => {
    setMounted(true);
  }, []);

  // SWRでリアルタイム更新
  const { postList, error, isValidating, mutate } = usePostListSwr({
    categoryId,
    staticPostList,
  });

  // マウント前は静的データを表示（ハイドレーション問題回避）
  const displayPostList = mounted ? postList : staticPostList;

  // デバッグ情報
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEBUG === 'true' && mounted) {
      console.log('🔄 PostListClient State:', {
        mounted,
        isValidating,
        hasError: !!error,
        staticCount: staticPostList?.length || 0,
        swrCount: postList?.length || 0,
        categoryId,
      });
    }
  }, [mounted, isValidating, error, staticPostList, postList, categoryId]);

  return (
    <>
      {/* デバッグ情報表示 */}
      {process.env.NEXT_PUBLIC_DEBUG === 'true' && mounted && (
        <div className="mb-4 p-2 bg-gray-100 text-xs">
          <div>🔄 SWR Status: {isValidating ? 'Updating...' : 'Idle'}</div>
          <div>📊 Posts: {displayPostList?.length || 0}</div>
          {categoryId && <div>🏷️ Category ID: {categoryId}</div>}
          {error && <div className="text-red-600">❌ Error: {error.message}</div>}
        </div>
      )}

      {/* 記事一覧表示 */}
      <div className="flex flex-wrap w-main mx-auto">
        {displayPostList?.map((post) => (
          <div
            key={post.id}
            className="w-1/3 pr-4 pb-4 [&:nth-of-type(3n)]:pr-0"
          >
            <PostBox post={post} />
          </div>
        ))}
      </div>

      {/* 手動更新ボタン（デバッグ用） */}
      {process.env.NEXT_PUBLIC_DEBUG === 'true' && mounted && (
        <div className="mt-4 text-center">
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            {isValidating ? '更新中...' : '手動更新'}
          </button>
        </div>
      )}
    </>
  );
};

export default PostListClient;