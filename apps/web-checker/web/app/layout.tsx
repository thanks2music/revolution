import '@/styles/globals.css';

import type { Metadata, Viewport } from 'next';

import { AuthProvider } from '@/lib/auth/auth-context';

export const metadata: Metadata = {
  title: 'WEB チェッカー',
  description: 'ウェブページの決まった部分を見に行き、変わったら Slack に知らせます',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** ログインの状態は全画面で使うので、ここに置く。ログインが要る画面の出し分けは app/(protected)/layout.tsx */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
