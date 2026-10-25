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
import { generateBasicMetadata, generateWebSiteSchema } from '@/lib/metadata';

export const metadata = generateBasicMetadata();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const webSiteSchema = generateWebSiteSchema();

  return (
    <html lang="ja">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteSchema) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
