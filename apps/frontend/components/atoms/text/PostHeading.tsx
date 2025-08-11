"use client";

import { ReactNode } from "react";

const PostHeading = ({ children }: { children: ReactNode }) => {
  return (
    <h1 className="font-bold text-3xl tracking-wide py-5 border-b-2 border-gray-600">
      {children}
    </h1>
  );
};

export default PostHeading;
