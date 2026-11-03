import { CategorySchema } from '@revolution/schemas/category';
import { cache } from 'react';
import { z } from 'zod';

import { findReservedSlugs } from '@/lib/category/reserved-segments';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * イベント種別 (`categories`) の読み取り。
 *
 * 種別は**企画の URL の第 1 階層** (`/{slug}/{id}`)。2026-11-03 の migration 0017 で
 * 5 件 (collabo-cafe / pop-up-store / exhibition / chain-store / other) に絞った。
 * どの種別があるかは DB が正で、frontend に一覧を書かない (足すときは migration だけ)。
 */

/** 種別の一覧ページの見出しと静的パラメータに要る列だけ。 */
export const CategoryItemSchema = CategorySchema.pick({ slug: true, name: true });

export type CategoryItem = z.infer<typeof CategoryItemSchema>;

/**
 * 全種別を id 順で返す。
 *
 * 資格情報が無いビルド (CI の `Build Apps`) では 0 件を返す。`[event_type]` の
 * `dynamicParams = false` と組み合わさり、そのビルドでは種別のページがすべて 404 になる。
 * 資格情報があるのにクエリが失敗した場合は throw する (`listOccurrenceParams` と同じ理由:
 * 本番ビルドで 0 ページのまま静かに成功させない)。
 *
 * `React.cache()` は同じ render の中 (`generateMetadata` とページ本体) の重複を省く。
 */
export const listCategories = cache(async function listCategories(): Promise<CategoryItem[]> {
  if (!hasPublicSupabaseCredentials()) {
    // 黙って 0 件にしない。ビルドログに理由を残す。
    console.warn(
      '[category] Supabase の公開接続情報が無いため、イベント種別を 0 件として扱います ' +
        '(資格情報を持たないビルドでは想定どおり)。種別のページは 404 になります。',
    );
    return [];
  }

  const supabase = createPublicClient();

  // 行は数件だが、全件列挙は単発 select にしない規約に揃える (理由は `lib/supabase/paginate.ts`)。
  const rows = await fetchAllRows({
    label: 'categories',
    fetchPage: (from, to) =>
      supabase
        .from('categories')
        .select('slug, name')
        .order('id', { ascending: true })
        .range(from, to),
  });

  return z.array(CategoryItemSchema).parse(rows);
});

/** slug が一致する種別。無ければ null。 */
export async function getCategory(slug: string): Promise<CategoryItem | null> {
  return (await listCategories()).find((category) => category.slug === slug) ?? null;
}

/**
 * `app/[event_type]/page.tsx` (種別の一覧) の `generateStaticParams` 用。
 *
 * 🔴 種別の slug がトップ階層の静的ルート (`titles` など) と重なっていたら **throw してビルドを止める**。
 * 重なった種別のページは静的ルートに負けて黙って届かなくなるため
 * (理由は `lib/category/reserved-segments.ts`)。ビルド時に止めれば、本番は直前のデプロイのまま残る。
 */
export async function listCategoryParams(): Promise<{ event_type: string }[]> {
  const categories = await listCategories();

  const reserved = findReservedSlugs(categories.map((category) => category.slug));
  if (reserved.length > 0) {
    throw new Error(
      `イベント種別の slug がトップ階層の静的ルートと重なっています: ${reserved.join(', ')}。` +
        'categories の slug を変えてください (lib/category/reserved-segments.ts)。',
    );
  }

  return categories.map((category) => ({ event_type: category.slug }));
}
