import Link from 'next/link';
import Image from 'next/image';
import { env } from '@/lib/env';

const navItems = [
  { name: '記事一覧', href: '/articles' },
  { name: 'カテゴリ', href: '/articles' }, // TODO: 専用ページ /categories を engineering/frontend で新設予定
  { name: 'About', href: '/#about' },
];

const HamburgerIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

const Header = () => {
  const siteTitle = env.NEXT_PUBLIC_SITE_NAME ?? 'Revolution';

  return (
    <header className="relative border-b bg-bg-primary">
      <div className="w-main mx-auto flex items-center justify-between gap-4 py-5 md:py-7">
        <Link
          href="/"
          aria-label={`${siteTitle} ホーム`}
          className="group flex items-center gap-3"
        >
          <Image
            src="/images/logo-revolution.png"
            alt=""
            width={120}
            height={120}
            className="h-9 w-auto sm:h-10"
            priority
          />
          <span className="font-display text-2xl tracking-tight text-ink-strong sm:text-3xl">
            {siteTitle}
          </span>
        </Link>

        <nav
          aria-label="グローバルナビゲーション"
          className="hidden items-center gap-9 md:flex"
        >
          {navItems.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="font-display text-sm tracking-wide text-ink-strong transition-colors hover:text-primary-600"
            >
              {item.name}
            </Link>
          ))}
        </nav>

        {/* Mobile: CSS-only details disclosure */}
        <details className="group md:hidden [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden">
          <summary
            aria-label="メニューを開閉"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-strong transition-colors hover:bg-bg-tinted"
          >
            <span className="sr-only">メニュー</span>
            <HamburgerIcon />
          </summary>
          <div className="absolute inset-x-0 top-full z-40 border-t bg-bg-elevated shadow-sm">
            <nav
              aria-label="グローバルナビゲーション (モバイル)"
              className="w-main mx-auto flex flex-col py-2"
            >
              {navItems.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className="font-display border-b py-3 text-base text-ink-strong last:border-b-0"
                >
                  {item.name}
                </Link>
              ))}
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
};

export default Header;
