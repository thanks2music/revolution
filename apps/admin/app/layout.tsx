import '@fontsource-variable/noto-sans-jp';
import '@fontsource/zen-kaku-gothic-new/700.css';
import '@/styles/globals.css';

import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '管理',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
