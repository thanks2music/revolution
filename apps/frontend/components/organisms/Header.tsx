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
  const siteTitle = siteConfig.name;

  return (
    <header className="relative border-b bg-bg-primary">
      <div className="w-main mx-auto flex items-center justify-between gap-4 py-5 md:py-7">
        <Link href="/" className="flex items-center">
          {/*
            画像だけのリンクなので、リンクの名前は alt が持つ (HTML の仕様。aria-label では
            画像が読み込めないときに文字が残らない)。フッターのロゴと同じ名前にする。

            高さはモバイル 34px・PC 42px。ヘッダーの高さはロゴではなく、メニューボタン
            (40px、md 未満) と AuthNav (44px、md 以上) が決めている。42px への切り替えを
            sm にすると 640〜767px でメニューボタンを超えてヘッダーが伸びるので、md にする。

            上部の画像なので loading="eager" にする。Next.js の preload は LCP の画像に使う
            もので、このロゴには付けない。なお React は、遅延読み込みでない img の preload
            の link を SSR で自動で出すので、ロゴは head の段階で取得が始まる。

            静的 import にすると、URL に内容のハッシュが付いて長期キャッシュされ、
            固有の寸法 (327×90) もファイルから入る。
          */}
          <Image
            src={logo}
            alt={`${siteTitle} ホーム`}
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
