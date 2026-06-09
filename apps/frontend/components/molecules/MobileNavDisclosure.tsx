'use client';

import { useRef } from 'react';
import Link from 'next/link';

import { AuthNav } from '@/components/molecules/AuthNav';

type NavItem = { name: string; href: string };

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

/**
 * モバイル用ナビゲーション disclosure。
 *
 * `<details>` を素朴に使うとき、Next.js の client-side navigation 後も
 * `open` 属性が残ってしまい、リンク遷移後にメニューが画面を覆ったままになる。
 * Link クリック時に `open` を外すために最小限の Client Component として分離する
 * （Header 本体は Server Component のまま）。
 */
export const MobileNavDisclosure = ({ navItems }: { navItems: NavItem[] }) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const close = () => detailsRef.current?.removeAttribute('open');

  return (
    <details
      ref={detailsRef}
      className="group md:hidden [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
    >
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
              onClick={close}
              className="font-display flex min-h-11 items-center border-b py-3 text-base text-ink-strong last:border-b-0"
            >
              {item.name}
            </Link>
          ))}
          <AuthNav variant="mobile" onNavigate={close} />
        </nav>
      </div>
    </details>
  );
};

export default MobileNavDisclosure;
