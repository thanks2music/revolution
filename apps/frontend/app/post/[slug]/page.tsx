import PostService from "@/services/PostService";
import CommImage from "@/components/atoms/image/CommImage";
import Layout from "@/components/templates/Layout";
import CategoryLabel from "@/components/atoms/label/CategoryLabel";
import DateText from "@/components/atoms/text/DateText";
import PostHeading from "@/components/atoms/text/PostHeading";
import Link from "next/link";
import { Metadata } from "next";
import { notFound } from "next/navigation";

// Dynamic metadata
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = await PostService.getOne({ id: params.slug });

  if (!post) {
    return {
      title: "Post Not Found",
    };
  }

  return {
    title: post.title,
    description: post.content.substring(0, 160), // Use first 160 chars as description
  };
}

// Replace getStaticPaths with generateStaticParams
export async function generateStaticParams() {
  const paths = await PostService.getAllSlugList();
  return paths;
}

export default async function Post({ params }: { params: { slug: string } }) {
  const post = await PostService.getOne({ id: params.slug });

  if (!post) {
    notFound();
  }

  return (
    <Layout>
      <div className="w-main mx-auto">
        <article>
          <div className="mb-4">
            <CommImage
              src={post.featuredImage.url}
              alt=""
              className="w-full h-96"
            />
          </div>
          <div className="flex mb-4">
            <div className="mr-3">
              <Link href={`/category/${post.category.slug}`}>
                <CategoryLabel>{post.category.name}</CategoryLabel>
              </Link>
            </div>
            <DateText>{post.date}</DateText>
          </div>
          <div className="mb-6">
            <PostHeading>{post.title}</PostHeading>
          </div>
          <div dangerouslySetInnerHTML={{ __html: post.content }}></div>
        </article>
      </div>
    </Layout>
  );
}
