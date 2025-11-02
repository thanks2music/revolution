/**
 * Global Loading UI
 * Next.js 14 App Router のSuspense fallback
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/loading
 */

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        {/* スピナーアニメーション */}
        <div className="inline-block relative w-20 h-20">
          <div className="absolute border-4 border-gray-200 rounded-full w-20 h-20"></div>
          <div className="absolute border-4 border-indigo-600 border-t-transparent rounded-full w-20 h-20 animate-spin"></div>
        </div>

        {/* ローディングテキスト */}
        <p className="mt-4 text-sm text-gray-600" role="status" aria-live="polite">
          読み込み中...
        </p>

        {/* スクリーンリーダー用の説明 */}
        <span className="sr-only">ページを読み込んでいます。しばらくお待ちください。</span>
      </div>
    </div>
  );
}
