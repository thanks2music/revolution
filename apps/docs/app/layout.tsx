import './global.css';

import { i18nProvider } from 'fumadocs-ui/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { translations } from '@/lib/layout.shared';
import { rootMetadata } from '@/lib/metadata';

export const metadata: Metadata = rootMetadata;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider i18n={i18nProvider(translations)}>{children}</RootProvider>
      </body>
    </html>
  );
}
