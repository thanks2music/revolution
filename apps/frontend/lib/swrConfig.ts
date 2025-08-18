/**
 * SWR設定管理
 * 開発環境と本番環境で異なる設定を適用
 */

// 開発環境判定
const isDevelopment = process.env.NODE_ENV === 'development';

// 環境別設定
export const SWR_CONFIG = {
  // リフレッシュ間隔（ミリ秒）
  refreshInterval: isDevelopment 
    ? parseInt(process.env.NEXT_PUBLIC_SWR_REFRESH_INTERVAL || '10000', 10)  // 開発: 10秒
    : 60000,  // 本番: 60秒

  // 重複排除間隔（ミリ秒）
  dedupingInterval: isDevelopment
    ? parseInt(process.env.NEXT_PUBLIC_SWR_DEDUPING_INTERVAL || '10000', 10)  // 開発: 10秒
    : 60000,  // 本番: 60秒

  // タブフォーカス時の再検証
  revalidateOnFocus: !isDevelopment,  // 本番環境のみ有効

  // 再接続時の再検証
  revalidateOnReconnect: true,

  // エラー時の再試行
  shouldRetryOnError: true,

  // エラー時の再試行回数
  errorRetryCount: 3,

  // エラー時の再試行間隔（ミリ秒）
  errorRetryInterval: 5000,

  // 画面非表示時の更新を停止
  refreshWhenHidden: false,

  // オフライン時の更新を停止
  refreshWhenOffline: false,
} as const;

// ISR設定
export const ISR_CONFIG = {
  // ページ全体の再生成間隔（秒）
  revalidate: 120,  // 2分
} as const;

// SWRキー生成ヘルパー
export const createSWRKey = {
  postList: (categoryId?: number) => 
    categoryId ? ['posts', 'category', categoryId] : ['posts'],
  
  post: (slug: string) => 
    ['post', slug],
} as const;

// デバッグ用ログ
export const logSWRConfig = () => {
  if (process.env.NEXT_PUBLIC_DEBUG === 'true') {
    console.log('🔧 SWR Config:', {
      environment: isDevelopment ? 'development' : 'production',
      refreshInterval: SWR_CONFIG.refreshInterval,
      dedupingInterval: SWR_CONFIG.dedupingInterval,
      revalidateOnFocus: SWR_CONFIG.revalidateOnFocus,
    });
  }
};