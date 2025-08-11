"use client";

import { ReactNode } from "react";

const ArticleOnListHeading = ({ children }: { children: ReactNode }) => {
  return <h1 className="font-bold text-lg">{children}</h1>;
};

export default ArticleOnListHeading;
