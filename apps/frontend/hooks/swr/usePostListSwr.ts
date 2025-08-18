import useSWR from "swr";
// const
import { WpGraphQlPostConst } from "../../constants/WpGraphQlConst";
// type
import PostOnListType from "../../types/PostOnListType";
// service
import PostService from "../../services/PostService";
// config
import { SWR_CONFIG, createSWRKey, logSWRConfig } from "../../lib/swrConfig";

const usePostListSwr = ({
  categoryId,
  staticPostList,
}: {
  categoryId?: number;
  staticPostList: PostOnListType[];
}) => {
  // デバッグログ出力
  if (process.env.NEXT_PUBLIC_DEBUG === 'true') {
    logSWRConfig();
  }

  // SWRキーとフェッチャーの設定
  const key = createSWRKey.postList(categoryId);
  const fetcher = categoryId 
    ? () => PostService.getList({ categoryId })
    : () => PostService.getList({});

  const { data: postList, error, isValidating, mutate } = useSWR(
    key, 
    fetcher, 
    {
      fallbackData: staticPostList,
      refreshInterval: SWR_CONFIG.refreshInterval,
      dedupingInterval: SWR_CONFIG.dedupingInterval,
      revalidateOnFocus: SWR_CONFIG.revalidateOnFocus,
      revalidateOnReconnect: SWR_CONFIG.revalidateOnReconnect,
      shouldRetryOnError: SWR_CONFIG.shouldRetryOnError,
      errorRetryCount: SWR_CONFIG.errorRetryCount,
      errorRetryInterval: SWR_CONFIG.errorRetryInterval,
      refreshWhenHidden: SWR_CONFIG.refreshWhenHidden,
      refreshWhenOffline: SWR_CONFIG.refreshWhenOffline,
      onError: (error) => {
        console.error('🚨 SWR Error in usePostListSwr:', {
          categoryId,
          error: error.message || error,
          timestamp: new Date().toISOString(),
        });
      },
      onSuccess: (data) => {
        if (process.env.NEXT_PUBLIC_DEBUG === 'true') {
          console.log('✅ SWR Success in usePostListSwr:', {
            categoryId,
            postCount: data?.length || 0,
            timestamp: new Date().toISOString(),
          });
        }
      },
    }
  );

  return {
    postList,
    error,
    isValidating,
    mutate,
  };
};

export default usePostListSwr;
