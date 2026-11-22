import BottomTabBar from '../organisms/BottomTabBar';
import Header from '../organisms/Header';
import Footer from '../organisms/Footer';
import { ReactNode } from 'react';

import { AuthNavProvider } from '../molecules/AuthNavProvider';

const Layout = ({
  children,
  hidePt = false,
  bottomBar,
}: {
  children: ReactNode;
  hidePt?: boolean;
  /**
   * スマホで画面の下に固定するページの操作 (例: 開催のページの「口コミを書く」)。下のタブのバーの上に置き、
   * 隠れる分の余白も下に足す。ページの部品がタブのバーの高さを知らなくて済むよう、ここで持つ
   */
  bottomBar?: ReactNode;
}) => {
  return (
    // AuthNavProvider (Client Component) で Header / children / Footer を包む。
    // children (Server Component) は server-rendered のまま (client provider + server
    // children パターン)。これで Header/モバイル/Footer の全 AuthNav が同一 Provider 配下に
    // 入り、認証状態の取得 (getAuthNav) が 1 ページ 1 回に集約される (Vercel 監査)。
    <AuthNavProvider>
      <div
        className={`flex min-h-screen flex-col md:pb-0 ${
          bottomBar ? 'pb-[calc(var(--space-bottom-tab)+5rem)]' : 'pb-(--space-bottom-tab)'
        }`}
      >
        {/* スキップリンク: WCAG 2.1 Level A 準拠 */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary-strong focus:px-4 focus:py-2 focus:text-white focus:shadow-lg"
        >
          メインコンテンツへスキップ
        </a>

        <Header />

        <main id="main-content" tabIndex={-1} className={`mb-auto ${hidePt ? '' : 'pt-10'}`}>
          {children}
        </main>

        <Footer />

        {/*
          モバイルの下部タブ (v5 #1 / v6 の全モック)。`fixed` なので、上の
          コンテンツが隠れないよう `div` 側に下パディングを入れてある。
        */}
        {bottomBar && (
          <div className="fixed inset-x-0 bottom-(--space-bottom-tab) z-30 border-t border-(--line-soft) bg-white/95 px-4 pt-3 pb-4 backdrop-blur md:hidden">
            {bottomBar}
          </div>
        )}
        <BottomTabBar />
      </div>
    </AuthNavProvider>
  );
};

export default Layout;
