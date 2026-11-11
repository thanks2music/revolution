'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * ライト / ダークの切り替えの土台 (next-themes。shadcn/ui の Next.js の手順)。
 * html に .light / .dark のクラスを付け、globals.css の `@custom-variant dark` がそれを見る。
 * Server Component の layout から使えるよう、ここで 'use client' の境界を引く。
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
