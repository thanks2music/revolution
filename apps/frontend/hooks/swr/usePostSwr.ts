import useSWR from "swr";
// const
import { WpGraphQlPostConst } from "../../constants/WpGraphQlConst";
// type
import PostType from "../../types/PostType";
// service
import PostService from "../../services/PostService";
// config
import { SWR_CONFIG, createSWRKey, logSWRConfig } from "../../lib/swrConfig";

const usePostSwr = ({
  id,
  staticPost,
}: {
  id: string;
  staticPost: PostType;
}) => {
  // デバッグログ出力
  if (process.env.NEXT_PUBLIC_DEBUG === 'true') {
    logSWRConfig();
  }

  // SWRキーとフェッチャーの設定
  const key = createSWRKey.post(id);
  const fetcher = () => PostService.getOne({ id });

  const { data: post, error, isValidating, mutate } = useSWR(
    key, 
    fetcher, 
    {
      fallbackData: staticPost,
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
        console.error('🚨 SWR Error in usePostSwr:', {
          postId: id,
          error: error.message || error,
          timestamp: new Date().toISOString(),
        });
      },
      onSuccess: (data) => {
        if (process.env.NEXT_PUBLIC_DEBUG === 'true') {
          console.log('✅ SWR Success in usePostSwr:', {
            postId: id,
            postTitle: data?.title || 'Unknown',
            timestamp: new Date().toISOString(),
          });
        }
      },
    }
  );

  return {
    post,
    error,
    isValidating,
    mutate,
  };
};

export default usePostSwr;
