/**
 * 作品一覧 `/titles` (S2)
 *
 * 作品ハブ (`/titles/{slug}`) への入口。titles マスタの全行を並べる
 * (`generateStaticParams` と同じ集合なのでリンク先は必ず生成済み = 404 しない)。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/molecules/EmptyState';
import Layout from '@/components/templates/Layout';
import { generateContentMetadata } from '@/lib/metadata';
import { titleKindLabel } from '@/lib/title/contracts';
import { listTitleDetails } from '@/lib/title/queries';
import { getTitleUrl } from '@/lib/title/title-url';

export const revalidate = 120;

export const metadata: Metadata = generateContentMetadata({
  title: '作品から探す',
  description:
    'アニメ・漫画・映画などの作品一覧。作品ごとにコラボカフェ・イベントの開催情報と記事を集約しています。',
  path: '/titles',
});

export default async function TitlesPage() {
  const titles = await listTitleDetails();

  return (
    <Layout>
      <div className="mx-auto w-main py-section-sp md:py-section-pc">
        <nav aria-label="パンくず" className="mb-6 text-sm text-ink-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:underline">
                ホーム
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">作品から探す</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          作品から探す
        </h1>

        {titles.length > 0 ? (
          <>
            <p className="mb-6 text-sm text-ink-muted">
              <span className="font-numeric tabular-nums">{titles.length}</span> 作品
            </p>

            <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3" data-grid-layout="block">
              {titles.map((title) => (
                <li key={title.slug}>
                  <Link
                    href={getTitleUrl(title.slug)}
                    className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line-soft)] bg-bg-elevated p-3 shadow-sm transition-colors hover:border-primary-300"
                  >
                    <span className="font-display font-bold text-ink-strong">{title.name}</span>
                    <span className="rounded-md bg-bg-tinted px-1.5 py-0.5 font-display text-xs tracking-wide text-primary-700">
                      {titleKindLabel(title.kind)}
                    </span>
                    <span aria-hidden="true" className="ml-auto text-ink-muted">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState message="作品はまだ登録されていません。" />
        )}
      </div>
    </Layout>
  );
}
