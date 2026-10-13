const TITLE = 'この記事のポイント';

/**
 * 「この記事のポイント」の枠 (リード文の直後、2026-10-13 BOSS 決定)。
 * 中身 (事実の行と「本イベントの特徴」の箇条書き) は AI Writer が MDX に書く:
 *
 *   <ArticlePoints>
 *
 *   - 2026年10月16日〜12月20日、東京・愛知・大阪・北海道の 4 会場
 *   - ...
 *
 *   </ArticlePoints>
 */
export function ArticlePoints({ children }: { children?: React.ReactNode }) {
  return (
    <aside
      aria-label={TITLE}
      className="my-8 rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 dark:border-blue-800 dark:bg-blue-950 [&_ul]:my-2 [&_ul]:space-y-1"
    >
      <p className="mb-1 text-base font-bold text-blue-900 dark:text-blue-100">{TITLE}</p>
      {children}
    </aside>
  );
}

export default ArticlePoints;
