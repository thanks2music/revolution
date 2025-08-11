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
      {" "}
      {/* Footerがスクリーン最下部になるように */}
      <Header />
      <div className={`mb-auto ${hidePt ? "" : "pt-10"}`}>{children}</div>{" "}
      {/* Footer最下部 + hidePtの条件分岐 */}
      <Footer />
    </div>
  );
};

export default Layout;
