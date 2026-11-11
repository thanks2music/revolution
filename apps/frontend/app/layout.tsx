import '@/styles/globals.css';
// フォントは Noto Sans JP (本文) と Zen Kaku Gothic New (見出し) の 2 つだけにする (2026-10-26 決定)。
// next/font/google はビルドのたびに Google からフォントを取得し、その失敗でビルドが落ちていたため、
// Fontsource (npm) から配る。どちらの CSS も文字の範囲 (unicode-range) ごとにファイルが分かれていて、
// ブラウザはページに出る文字の分だけ読む。next/font/local は範囲ごとの指定ができないので使わない。
// Noto Sans JP は可変フォント。1 つのファイルで全ウェイトを描くので、太字を足してもファイルは増えない。
// Zen Kaku Gothic New には可変フォントが無く、ウェイトを足すとファイルの組がもう 1 つ増える。
// 名前と代わりの字形は styles/globals.css の --font-* と @font-face。
import '@fontsource-variable/noto-sans-jp';
import '@fontsource/zen-kaku-gothic-new/900.css';
import { ThemeProvider } from '@/components/theme-provider';
import { generateBasicMetadata, generateWebSiteSchema } from '@/lib/metadata';

export const metadata = generateBasicMetadata();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const webSiteSchema = generateWebSiteSchema();

  return (
    // next-themes が描画前に html の class を書き換えるため、その差を hydration の警告にしない
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteSchema) }}
        />
      </head>
      <body>
        {/*
          ダークの色はリデザインで作るまで無いので、ライトに固定する (OS の設定も見ない)。
          切り替えを出す時は forcedTheme を外し、defaultTheme・enableSystem・
          disableTransitionOnChange を決める。
        */}
        <ThemeProvider attribute="class" forcedTheme="light">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
