import '@/styles/globals.css';
// フォントは Fontsource (npm) から配る。next/font/google はビルドのたびに Google から
// フォントを取得し、その取得の失敗でビルドが落ちていた (2026-10)。Fontsource の CSS は
// Google Fonts と同じく文字の範囲 (unicode-range) ごとにファイルを分けているので、
// ブラウザはページに出る文字の分だけ読む。next/font/local は範囲ごとの指定ができず、
// 日本語フォントを 1 ウェイト丸ごと読ませることになるため使わない。
// 名前と代わりの字形は styles/globals.css の --font-* と @font-face。
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/zen-kaku-gothic-new/900.css';
// 記事カードの見出し用 (Claude Design v6 #17/#18)
import '@fontsource/zen-old-mincho/600.css';
// 残日数バッジ・日付の数字用
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import '@fontsource/inter-tight/900.css';
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
