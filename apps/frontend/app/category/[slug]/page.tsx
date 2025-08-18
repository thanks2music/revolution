import PostService from "@/services/PostService";
import Layout from "@/components/templates/Layout";
import PostListClient from "@/components/organisms/PostListClient";
import { Metadata } from "next";
import { ISR_CONFIG } from "@/lib/swrConfig";

// ISR設定をexport
export const revalidate = ISR_CONFIG.revalidate; // 120秒

// Dynamic metadata
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  return {
    title: `Category: ${params.slug} - Revolution Platform`,
    description: `Posts in category ${params.slug} with ISR × useSWR`,
  };
}

// Replace getStaticPaths with generateStaticParams
export async function generateStaticParams() {
  const paths = await PostService.getAllCategorySlugList();
  return paths;
}

export default async function Category({
  params,
}: {
  params: { slug: string };
}) {
  // カテゴリIDを取得
  const categoryId = await PostService.getCategoryIdBySlug({
    slug: params.slug,
  });
  
  // サーバーサイドで初期データ取得（ISR適用）
  const staticPostList = await PostService.getList({ categoryId });

  return (
    <Layout>
      {/* カテゴリ情報表示 */}
      <div className="w-main mx-auto mb-6">
        <h1 className="text-3xl font-bold border-b-2 border-gray-600 pb-4">
          Category: {params.slug}
        </h1>
      </div>

      {/* Client Component: useSWRでリアルタイム更新 */}
      <PostListClient staticPostList={staticPostList} categoryId={categoryId} />
    </Layout>
  );
}
