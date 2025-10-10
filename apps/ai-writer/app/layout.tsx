import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth/auth-context';

export const metadata: Metadata = {
  title: 'AI Writer - Discovery Management',
  description: 'AI-powered content management system',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}