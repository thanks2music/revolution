"use client";

import { ReactNode } from "react";

const DateText = ({ children }: { children: ReactNode }) => {
  return (
    <span className="text-gray-500 font-light inline-block">{children}</span>
  );
};

export default DateText;
