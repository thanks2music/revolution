import Link from 'next/link';
import Image from 'next/image';

import { AuthNav } from '@/components/molecules/AuthNav';
import { siteConfig } from '@/lib/metadata';
import logo from '@/public/images/logo-horizontal.svg';

/**
 * リンクの描き方を決める種別。既定は route。
 * - route: アプリのページ。<Link> で描き、先読みとクライアント遷移を使う
 * - document: ページでない同じサイトの URL (sitemap.xml など)。<a> で描き、同じタブで開く。
 *   <Link> で描くと、画面に入った時やクリックした時に RSC を取りに行き、本番では 404 になる
 * - external: 外部サイト。新しいタブで開く
 */
type FooterLinkKind = 'route' | 'document' | 'external';
type FooterLink = { name: string; href: string; kind?: FooterLinkKind };
type FooterColumn = { title: string; items: FooterLink[] };

const linkClass = 'text-sm text-ink-strong transition-colors hover:text-primary-600';

const columns: FooterColumn[] = [
  {
    title: 'Articles',
    items: [
      { name: '記事一覧', href: '/articles' },
    ],
  },
  {
    title: 'About',
    items: [
      { name: `${siteConfig.name}について`, href: '/#about' },
      { name: 'Sitemap', href: '/sitemap.xml', kind: 'document' },
    ],
  },
  {
    title: 'Connect',
    items: [
      { name: 'GitHub', href: 'https://github.com/thanks2music/revolution', kind: 'external' },
    ],
  },
];

const Footer = () => {
  return (
    <footer className="mt-16 border-t bg-bg-primary md:mt-24">
      <div className="w-main mx-auto py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex">
              {/*
                リンクの名前は alt が持つ。ヘッダーのロゴと同じ名前にする。

                高さ 44px (幅 160px)。5 列になる 768〜863px では 1 列目が 160px に届かない。
                そこでは Tailwind の preflight (img の max-width: 100%) が img の幅を列に合わせ、
                object-contain が縦横比を保って描く。img の箱は高さ 44px のままで、見えるロゴは
                768px で高さ約 38px になる。
              */}
              <Image
                src={logo}
                alt={`${siteConfig.name} ホーム`}
                className="h-11 w-auto object-contain"
              />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-muted">
              推し活イベントで体験した思い出を、
              <br />
              記録・レビューする。
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="font-display mb-4 text-xs tracking-[0.18em] text-ink-muted uppercase">
                {column.title}
              </h3>
              <ul className="space-y-2.5">
                {column.items.map((item) => (
                  <li key={item.name}>
                    {item.kind === 'external' ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                      >
                        {item.name} ↗
                      </a>
                    ) : item.kind === 'document' ? (
                      <a href={item.href} className={linkClass}>
                        {item.name}
                      </a>
                    ) : (
                      <Link href={item.href} className={linkClass}>
                        {item.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="font-display mb-4 text-xs tracking-[0.18em] text-ink-muted uppercase">
              Account
            </h3>
            <ul className="space-y-2.5">
              <li>
                <AuthNav variant="footer" />
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-3 border-t pt-6 text-xs text-ink-muted">
          <p>© {siteConfig.name}</p>
          <p className="font-numeric tabular-nums tracking-wide">
            Powered by AI Writer × Next.js 16 / React 19
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
