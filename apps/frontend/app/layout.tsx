import "@/styles/globals.css";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "WordPress Next.js Blog",
  description: "A blog built with Next.js and WordPress",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
