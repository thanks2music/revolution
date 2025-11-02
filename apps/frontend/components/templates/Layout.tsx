"use client";

import Header from "../organisms/Header";
import Footer from "../organisms/Footer";
import { ReactNode } from "react";

const Layout = ({
  children,
  hidePt = false,
}: {
  children: ReactNode;
  hidePt?: boolean; // hidePt?とすることで必須ではなくなる
}) => {
  return (
    <div className="flex flex-col min-h-screen">
      {/* スキップリンク: キーボードナビゲーション向上（WCAG 2.1 Level A） */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-md focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* ヘッダー: セマンティックHTML */}
      <Header />

      {/* メインコンテンツ: セマンティックHTML + アクセシビリティ */}
      <main
        id="main-content"
        tabIndex={-1}
        className={`mb-auto ${hidePt ? "" : "pt-10"}`}
      >
        {children}
      </main>

      {/* フッター: 既にセマンティックfooterタグ使用 */}
      <Footer />
    </div>
  );
};

export default Layout;
