import Link from 'next/link';
import Image from 'next/image';

const columns = [
  {
    title: 'Articles',
    items: [
      { name: '記事一覧', href: '/articles' },
      { name: 'カテゴリ別', href: '/articles' }, // TODO: dedicated /categories page
    ],
  },
  {
    title: 'About',
    items: [
      { name: 'Revolution について', href: '/about' }, // TODO
      { name: 'Sitemap', href: '/sitemap.xml' },
    ],
  },
  {
    title: 'Connect',
    items: [
      { name: 'GitHub', href: 'https://github.com/thanks2music/revolution', external: true },
      { name: 'RSS Feed', href: '/feed.xml' }, // TODO: feed.xml endpoint
    ],
  },
];

const Footer = () => {
  return (
    <footer className="mt-16 border-t bg-bg-primary md:mt-24">
      <div className="w-main mx-auto py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Image
                src="/images/logo-revolution.png"
                alt=""
                width={120}
                height={120}
                className="h-8 w-auto"
              />
              <span className="font-display text-xl text-ink-strong">Revolution</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-muted">
              アニメ × イベント × 街 をめぐる、
              <br />
              AI 編集メディア。
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="font-display mb-4 text-xs tracking-[0.18em] text-ink-muted uppercase">
                {column.title}
              </h2>
              <ul className="space-y-2.5">
                {column.items.map((item) => (
                  <li key={item.name}>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-ink-strong transition-colors hover:text-primary-600"
                      >
                        {item.name} ↗
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className="text-sm text-ink-strong transition-colors hover:text-primary-600"
                      >
                        {item.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-3 border-t pt-6 text-xs text-ink-muted">
          <p>© Revolution</p>
          <p className="font-numeric tabular-nums tracking-wide">
            Powered by AI Writer × Next.js 16 / React 19
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
