/**
 * 種別の企画一覧 `/{種別}` (例 `/collabo-cafe`、2026-11-03 新設)。
 *
 * 企画の URL を `/{種別}/{id}` にしたので、末尾を削った `/{種別}` も一覧として成立させる。
 * 集合は `/events` と同じ `listEventListItems` を種別で絞ったもの (定義を 2 つ持たない)。
 * 企画が 0 件の種別も、`/events` と同じ空状態で描く。
 *
 * ## `dynamicParams = false`
 *
 * トップ階層の動的セグメントなので、`/titles` などの静的ルートに当たらない 1 階層の
 * パス (`/foo`) はすべてここへ来る。`categories` にある slug だけを生成し、それ以外は
 * **描画の前に 404** にする (スキャナが叩く `/wp-admin` のようなパスで、描画と ISR の
 * キャッシュ書き込みを起こさない)。
 *
 * ⚠️ この設定は `/{種別}` のルートだけに効く。Next.js はルート内の 1 セグメントでも
 * `false` があるとルート全体を「事前生成以外は 404」にする
 * (next/src/build/static-paths/app.ts の `segments.every(... !== false)`) ため、
 * 企画・開催のルート (`[id]` 以下) には置けない (新しい企画をビルドなしで出せなくなる)。
 * 種別を足す・改名する migration の後は、再デプロイまで新しい slug の一覧が 404 になる
 * (Vercel のビルドが migration より先に終わった場合も同じ。そのときは再デプロイする)。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EventSummaryList } from '@/components/organisms/EventSummaryList';
import Layout from '@/components/templates/Layout';
import { getCategory, listCategoryParams } from '@/lib/category/queries';
import { getEventTypeUrl } from '@/lib/event/event-url';
import { listEventListItems } from '@/lib/event/queries';
import { generateContentMetadata } from '@/lib/metadata';
import type { PageProps } from '@/types/page-props';

export const revalidate = 120;

export const dynamicParams = false;

export async function generateStaticParams() {
  return listCategoryParams();
}

type EventTypePageProps = PageProps<{ event_type: string }>;

export async function generateMetadata(props: EventTypePageProps): Promise<Metadata> {
  const { event_type } = await props.params;
  const category = await getCategory(event_type);

  if (!category) {
    return { title: '種別が見つかりません' };
  }

  return generateContentMetadata({
    title: category.name,
    description: `${category.name}の企画の一覧。企画ごとに全会場の開催情報を集約しています。`,
    path: getEventTypeUrl(category.slug),
  });
}

export default async function EventTypePage(props: EventTypePageProps) {
  const { event_type } = await props.params;
  const [category, events] = await Promise.all([getCategory(event_type), listEventListItems()]);

  if (!category) notFound();

  const items = events.filter((event) => event.primaryCategory.slug === category.slug);

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
              <Link href="/events" className="hover:underline">
                企画から探す
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">{category.name}</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl md:leading-10">
          {category.name}
        </h1>

        <EventSummaryList
          events={items}
          emptyMessage={`${category.name}の企画はまだ登録されていません。`}
          showTypeTag={false}
        />
      </div>
    </Layout>
  );
}
