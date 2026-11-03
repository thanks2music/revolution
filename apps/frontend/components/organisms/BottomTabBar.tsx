'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * モバイルの下部タブバー (Claude Design v3「下層バー」→ v5 #1 / v6 の全モック)。
 *
 * ## 3 タブである理由
 *
 * v5 / v6 は **「探す / 記事 / 投稿 / マイページ」の 4 タブ**を描いているが、
 * 「投稿」= レビュー投稿は **S4 の機能で未実装**。押せないタブを置くのは
 * 「データ源が無いものは描かない」という v6 の規律に反するため、
 * **投稿を除いた 3 タブで導入する** (2026-08-22 BOSS 確定)。S4 でレビューが
 * 入った時点で 4 タブへ戻す。
 *
 * ## md 未満だけに出す
 *
 * 768px 以上ではヘッダーのナビ (`Header.tsx` の `md:flex`) が同じ導線を持つので、
 * 二重に出さない。`md:hidden` で切り替える。
 *
 * ## 現在地の判定
 *
 * `usePathname()` を使うため Client Component。判定は**前方一致**で、
 * 配下ページ (`/titles/xxx`、`/articles/xxx`) にいてもタブが点灯する。
 * ⚠️ トップ (`/`) だけは前方一致だと全ページにマッチするので完全一致で見る。
 */

type Tab = {
  href: string;
  label: string;
  /** 現在地とみなすパスの基点。省略時は `href` 自身。 */
  bases?: string[];
  /**
   * 指定すると判定を反転し、**この基点の配下以外をすべて現在地**とみなす
   * (`bases` は無視)。「探す」が使う (理由は `EXPLORE_EXCLUDES`)。
   */
  excludes?: string[];
};

/**
 * タブが現在地かどうか (Layer 1、純粋関数)。
 *
 * ⚠️ **素の `startsWith` は使わない。** `/articles` が将来 `/articles-archive`
 *    のような別ルートを点灯させてしまう (2026-08-22 claude[bot] 指摘)。
 *    **完全一致、または `base + '/'` で始まる配下パス**だけを現在地とする。
 *
 * ロジックだけ切り出してあるのはテストのため。「トップで探すを点灯させる」
 * という特殊対応は静かに壊れやすいので、コンポーネントを描かずに固定する。
 */
export function isTabActive(pathname: string, bases: string[]): boolean {
  return bases.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

/**
 * `aria-current` の値を決める。
 *
 * 🔴 **`aria-current="page"` は「そのリンク先が今いるページ」のときだけ。**
 *    「探す」タブは `/titles` を指すが `/` `/events` `/venues` `/{種別}` にいるときも
 *    点灯させるため、一律 `page` にすると**踏むと別のページへ移動するリンクを
 *    支援技術が「現在のページ」と読み上げる** (2026-08-22 `/code-review` 指摘)。
 *
 *    区画としては現在地なので、完全一致以外は汎用の `true` を使う
 *    (WAI-ARIA の `aria-current` は `page` / `true` などを取り、`true` は
 *    「集合の中の現在の項目」を表す)。
 */
function currentValue(active: boolean, pathname: string, href: string) {
  if (!active) return undefined;
  return pathname === href ? 'page' : true;
}

/**
 * 「探す」を**点灯させない**パスの基点。これ以外はすべて「探す」の区画とみなす。
 *
 * ## なぜ反転させたか (2026-11-03)
 *
 * 以前は「探す」の基点を列挙していた (`/` `/titles` `/events` `/venues`)。企画・開催の
 * URL が `/{種別}/{id}` (`/collabo-cafe/11`) になり、第 1 階層が種別ごとに変わるため、
 * 列挙だと種別を足すたびにここも直す必要がある (種別の一覧は DB が正で、クライアントは
 * 持っていない)。探すは「記事・マイページ・認証まわり以外のすべて」なので、
 * そちらを列挙する方が漏れない。
 *
 * ⚠️ トップ (`/`) は探すの区画に入る。v5 #1 のホームは「探す」が点灯した状態で
 *    描かれており、トップ自体が探す導線の入口だから (タブに「ホーム」は無い)。
 */
export const EXPLORE_EXCLUDES = ['/articles', '/mypage', '/login', '/onboarding', '/auth'];

/** タブが現在地かどうか。`excludes` があれば判定を反転する (Layer 1、純粋関数)。 */
export function isTabCurrent(pathname: string, tab: Pick<Tab, 'href' | 'bases' | 'excludes'>) {
  if (tab.excludes) return !isTabActive(pathname, tab.excludes);
  return isTabActive(pathname, tab.bases ?? [tab.href]);
}

const TABS: Tab[] = [
  { href: '/titles', label: '探す', excludes: EXPLORE_EXCLUDES },
  { href: '/articles', label: '記事' },
  { href: '/mypage', label: 'マイページ' },
];

export const BottomTabBar = () => {
  const pathname = usePathname();

  return (
    <nav
      aria-label="モバイルナビゲーション"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line-soft)] bg-bg-elevated md:hidden"
    >
      <ul className="flex">
        {TABS.map((tab) => {
          const active = isTabCurrent(pathname, tab);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={currentValue(active, pathname, tab.href)}
                // min-h-11 でタップ領域を 44px 以上に (WCAG 2.5.8 / iOS HIG)。
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 font-display text-xs tracking-wide transition-colors ${
                  active ? 'text-primary-strong' : 'text-ink-muted'
                }`}
              >
                {/*
                  v5 はアイコンを置いているが、実装にアイコンセットが無い。
                  文字だけでも導線として成立するので、四角の色面で現在地を示す
                  (アイコン導入は別タスク)。
                */}
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${active ? 'bg-primary-strong' : 'bg-transparent'}`}
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default BottomTabBar;
