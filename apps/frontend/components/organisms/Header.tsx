import Link from 'next/link';
import Image from 'next/image';
import logo from '@/public/images/logo-horizontal.svg';
import { siteConfig } from '@/lib/metadata';
import { MobileNavDisclosure } from '@/components/molecules/MobileNavDisclosure';
import { AuthNav } from '@/components/molecules/AuthNav';

const navItems = [
  { name: '記事一覧', href: '/articles' },
  { name: 'About', href: '/#about' },
];

const Header = () => {
  return (
    <header className="relative border-b bg-bg-primary">
      <div className="w-main mx-auto flex items-center justify-between gap-4 py-5 md:py-7">
        <Link href="/" className="flex">
          {/*
            画像だけのリンクなので、名前は alt に持たせる (HTML の仕様。aria-label だと画像が
            読み込めないときに文字が残らない)。フッターのロゴと同じ名前にする。
            高さはモバイル 34px・PC 42px。ヘッダーの高さはメニューボタン (40px、md 未満) と
            AuthNav (44px、md 以上) が決めるので、42px にするのは md から (sm だと 640〜767px
            でヘッダーが伸びる)。LCP ではないので Next.js の preload は付けず eager にする
            (React は遅延読み込みでない img の preload を SSR で自動で出す)。
          */}
          <Image
            src={logo}
            alt={`${siteConfig.name} ホーム`}
            className="h-[34px] w-auto md:h-[42px]"
            loading="eager"
          />
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
