import Link from 'next/link';
import Image from 'next/image';
import { siteConfig } from '@/lib/metadata';
import { MobileNavDisclosure } from '@/components/molecules/MobileNavDisclosure';
import { AuthNav } from '@/components/molecules/AuthNav';

const navItems = [
  { name: '記事一覧', href: '/articles' },
  { name: 'About', href: '/#about' },
];

const Header = () => {
  const siteTitle = siteConfig.name;

  return (
    <header className="relative border-b bg-bg-primary">
      <div className="w-main mx-auto flex items-center justify-between gap-4 py-5 md:py-7">
        {/* リンクの名前は aria-label が持つので、ロゴの画像は alt="" にする (二重に読ませない)。 */}
        <Link href="/" aria-label={`${siteTitle} ホーム`} className="flex items-center">
          {/*
            高さはモバイル 34px・PC 42px。ヘッダーの高さはロゴではなく、メニューボタン
            (40px、md 未満) と AuthNav (44px、md 以上) が決めている。42px への切り替えを
            sm にすると 640〜767px でメニューボタンを超えてヘッダーが伸びるので、md にする。
            上部の画像なので遅延読み込みにしない。LCP ではないので preload は付けない
            (React は遅延読み込みでない img に、SSR で preload の link を自動で出す)。
          */}
          <Image
            src="/images/logo-horizontal.svg"
            alt=""
            width={327}
            height={90}
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
