/**
 * Next.js画像最適化確認ユーティリティ
 */

import { env } from './env';

export const getImageOptimizationInfo = () => {
  if (typeof window === 'undefined') return null;

  const images = document.querySelectorAll('img[src*="/_next/image"]');
  
  return Array.from(images).map(img => {
    const element = img as HTMLImageElement;
    return {
      alt: element.alt,
      src: element.src,
      currentSrc: element.currentSrc,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      displayWidth: element.width,
      displayHeight: element.height,
      loading: element.loading,
      isNextJsOptimized: element.src.includes('/_next/image'),
      format: getImageFormat(element.src),
    };
  });
};

const getImageFormat = (src: string): string => {
  const url = new URL(src, window.location.origin);
  const formatParam = url.searchParams.get('f');
  if (formatParam) return formatParam;
  
  // Content-Typeから推測
  if (src.includes('.webp')) return 'webp';
  if (src.includes('.avif')) return 'avif';
  return 'original';
};

// デバッグ用：コンソールに画像情報を出力
export const logImageOptimization = () => {
  if (env.NEXT_PUBLIC_DEBUG) {
    const info = getImageOptimizationInfo();
    console.log('🖼️ Next.js Image Optimization Info:', info);
  }
};