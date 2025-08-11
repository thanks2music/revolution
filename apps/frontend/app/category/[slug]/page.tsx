import PostService from "@/services/PostService";
import PostBox from "@/components/molecules/PostBox";
import Layout from "@/components/templates/Layout";
import { Metadata } from "next";

// Dynamic metadata
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  return {
    title: `Category: ${params.slug}`,
    description: `Posts in category ${params.slug}`,
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
  const categoryId = await PostService.getCategoryIdBySlug({
    slug: params.slug,
  });
  const posts = await PostService.getList({ categoryId });

  return (
    <Layout>
      <div className="flex flex-wrap w-main mx-auto">
        {posts.map((post) => (
          <div
            key={post.id}
            className="w-1/3 pr-4 pb-4 [&:nth-of-type(3n)]:pr-0"
          >
            <PostBox post={post} />
          </div>
        ))}
      </div>
    </Layout>
  );
}
