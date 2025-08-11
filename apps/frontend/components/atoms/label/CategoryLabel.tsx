"use client";

import { ReactNode } from "react";

const CategoryLabel = ({ children }: { children: ReactNode }) => {
  return (
    <span className="inline-block text-white bg-black px-2 py-[2px] text-sm">
      {children}
    </span>
  );
};

export default CategoryLabel;
