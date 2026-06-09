import Link from 'next/link';
import Image from 'next/image';
import { env } from '@/lib/env';
import { MobileNavDisclosure } from '@/components/molecules/MobileNavDisclosure';
import { AuthNav } from '@/components/molecules/AuthNav';

const navItems = [
  { name: '記事一覧', href: '/articles' },
  { name: 'About', href: '/#about' },
];

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
          <AuthNav variant="header" />
        </nav>

        <MobileNavDisclosure navItems={navItems} />
      </div>
    </header>
  );
};

export default Header;
