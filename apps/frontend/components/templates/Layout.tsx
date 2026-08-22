import BottomTabBar from '../organisms/BottomTabBar';
import Header from '../organisms/Header';
import Footer from '../organisms/Footer';
import { ReactNode } from 'react';

import { AuthNavProvider } from '../molecules/AuthNavProvider';

const Layout = ({
  children,
  hidePt = false,
}: {
  children: ReactNode;
  hidePt?: boolean;
}) => {
  return (
    // AuthNavProvider (Client Component) で Header / children / Footer を包む。
    // children (Server Component) は server-rendered のまま (client provider + server
    // children パターン)。これで Header/モバイル/Footer の全 AuthNav が同一 Provider 配下に
    // 入り、認証状態の取得 (getAuthNav) が 1 ページ 1 回に集約される (Vercel 監査)。
    <AuthNavProvider>
      <div className="flex min-h-screen flex-col pb-[var(--space-bottom-tab)] md:pb-0">
        {/* スキップリンク: WCAG 2.1 Level A 準拠 */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary-strong focus:px-4 focus:py-2 focus:text-white focus:shadow-lg"
        >
          メインコンテンツへスキップ
        </a>

        <Header />

        <main
          id="main-content"
          tabIndex={-1}
          className={`mb-auto ${hidePt ? '' : 'pt-10'}`}
        >
          {children}
        </main>

        <Footer />

        {/*
          モバイルの下部タブ (v5 #1 / v6 の全モック)。`fixed` なので、上の
          コンテンツが隠れないよう `div` 側に下パディングを入れてある。
        */}
        <BottomTabBar />
      </div>
    </AuthNavProvider>
  );
};

export default Layout;
