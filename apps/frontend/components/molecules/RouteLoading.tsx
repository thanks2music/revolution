/**
 * 動的ルートの読み込み中 UI (`loading.tsx` から使う)。
 *
 * ## ルートに置かず、動的ルートにだけ置く (2026-11-03)
 *
 * 以前は `app/loading.tsx` が全ページをこの UI の Suspense で包んでいた。
 * ストリーミングが始まると HTTP 200 が確定するため、その後の `notFound()` は
 * **200 のソフト 404**、`permanentRedirect()` は **200 + meta refresh** になっていた
 * (Next.js 公式 `loading.mdx` の「Status Codes」)。
 *
 * 公式は「**動的ルートに** `loading.tsx` を置く」ことを推奨している
 * (`linking-and-navigating.mdx` の Dynamic routes without `loading.tsx`)。静的・ISR の
 * ページは `<Link>` で完全に prefetch されるので不要。よって動的ルートにだけ置く:
 *
 * | ルート | 置き場所 |
 * |---|---|
 * | `/login` `/mypage` `/onboarding` | 各ディレクトリ (子ルートが無い) |
 * | `/articles` (ページ送り) | route group `app/articles/(list)/` (記事ページ `/articles/[slug]` を包まないため) |
 *
 * ⚠️ 子ルートを持つディレクトリ (`app/titles/` など) に置くと、子の 404 がまたソフト 404 になる。
 */

export function RouteLoading() {
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
