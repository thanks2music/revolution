import PostService from "@/services/PostService";
import Layout from "@/components/templates/Layout";
import PostListClient from "@/components/organisms/PostListClient";
import { Metadata } from "next";
import { ISR_CONFIG } from "@/lib/swrConfig";

// ISR設定をexport
export const revalidate = ISR_CONFIG.revalidate; // 120秒

// New metadata API
export const metadata: Metadata = {
  title: "Revolution Platform - Home",
  description: "Next.js + WordPress Headless CMS with ISR × useSWR",
};

// Server Component: ISRで初期データ取得
export default async function Home() {
  // サーバーサイドで初期データ取得（ISR適用）
  const staticPostList = await PostService.getList({});

  return (
    <Layout>
      {/* Client Component: useSWRでリアルタイム更新 */}
      <PostListClient staticPostList={staticPostList} />
    </Layout>
  );
}
