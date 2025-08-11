import PostService from "@/services/PostService";
import PostBox from "@/components/molecules/PostBox";
import Layout from "@/components/templates/Layout";
import { Metadata } from "next";

// New metadata API
export const metadata: Metadata = {
  title: "Home Page",
  description: "Welcome to our blog",
};

// Replace getStaticProps with async Server Component
export default async function Home() {
  const posts = await PostService.getList({});

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
