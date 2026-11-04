/**
 * トップ階層の静的セグメント = **イベント種別の slug に使えない名前**。
 *
 * 企画の URL の第 1 階層は種別 (`/{categories.slug}/{id}`、2026-11-03)。Next.js は
 * 静的セグメントを動的セグメントより優先するので、たとえば `titles` という種別を
 * 作ると `/titles` は作品一覧に当たり、その種別の一覧・企画ページに**黙って届かなくなる**。
 * 種別の slug は DB (migration) が決め、ルートの構成とは別の場所で増えるため、衝突は
 * ビルドで止める (`lib/category/queries.ts` の `listCategoryParams`)。
 *
 * 一覧が実際の構成とずれないよう、`__tests__/unit/lib/category/reserved-segments.test.ts`
 * が `app/`・`public/`・`next.config.mjs` を読んで照合する (ルートを足したらここも足す)。
 *
 * ファイル規約のルート (`sitemap.xml` / `robots.txt` / `favicon.ico`) はドットを含み、
 * slug の形 (`CATEGORY_SLUG_REGEX`) に一致し得ないので載せない。
 */

/** `app/` 直下の静的ルート (ディレクトリ)。 */
export const APP_ROUTE_SEGMENTS = [
  'articles',
  'auth',
  'events',
  'login',
  'mypage',
  'onboarding',
  'titles',
  'venues',
] as const;

/**
 * `next.config.mjs` の `redirects()` が受ける第 1 セグメント。
 * 今は無い (WordPress 時代の `/post`・`/category` は公開しておらず、2026-11-04 に削除)。
 * リダイレクトを足したら、ここにも足す (テストが照合する)。
 */
export const REDIRECT_SEGMENTS = [] as const satisfies readonly string[];

/** `public/` 直下のディレクトリ (静的ファイルはルートより先に返る)。 */
export const PUBLIC_DIR_SEGMENTS = ['images'] as const;

const RESERVED: ReadonlySet<string> = new Set<string>([
  ...APP_ROUTE_SEGMENTS,
  ...REDIRECT_SEGMENTS,
  ...PUBLIC_DIR_SEGMENTS,
]);

/** 予約された名前と重なる slug を返す (Layer 1、純粋関数)。 */
export function findReservedSlugs(slugs: readonly string[]): string[] {
  return slugs.filter((slug) => RESERVED.has(slug));
}
