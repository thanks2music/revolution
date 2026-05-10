import '@/styles/globals.css';
import { Noto_Sans_JP, Zen_Kaku_Gothic_New, Inter_Tight } from 'next/font/google';
import { generateBasicMetadata, generateWebSiteSchema } from '@/lib/metadata';

export const metadata = generateBasicMetadata();

// CJK フォントは subset が大きいため preload を切り、初期表示を阻害しない。
// next/font/google の Noto Sans JP / Zen Kaku Gothic New は `subsets` に
// 'latin' / 'latin-ext' / 'cyrillic' / 'vietnamese' のみ受け付ける
// （node_modules/.../@next/font/.../google/font-data.json で型決定済み）。
// Japanese 文字の描画品質は実機で要検証。代替手段として将来 `<link>` 直挿入
// を検討する余地あり (issue tracked: 表示確認後に判断)。
// Inter Tight も LCP には乗らない（残日数バッジ・日付の数字専用）ので同様。
const notoSansJP = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  preload: false,
});

const zenKakuGothicNew = Zen_Kaku_Gothic_New({
  weight: ['900'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  preload: false,
});

const interTight = Inter_Tight({
  weight: ['600', '700', '900'],
  subsets: ['latin'],
  variable: '--font-numeric',
  display: 'swap',
  preload: false,
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const webSiteSchema = generateWebSiteSchema();

  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} ${zenKakuGothicNew.variable} ${interTight.variable}`}
    >
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
