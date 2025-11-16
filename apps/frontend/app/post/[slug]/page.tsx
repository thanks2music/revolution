import PostService from "@/services/PostService";
import CommImage from "@/components/atoms/image/CommImage";
import Layout from "@/components/templates/Layout";
import CategoryLabel from "@/components/atoms/label/CategoryLabel";
import DateText from "@/components/atoms/text/DateText";
import PostHeading from "@/components/atoms/text/PostHeading";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sanitizeHtml, stripHtml } from "@/lib/sanitize";
import { generateArticleMetadata, generateArticleSchema } from "@/lib/metadata";

// Dynamic metadata
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}) {
  const post = await PostService.getOne({ id: params.slug });

  if (!post) {
    return {
      title: "Post Not Found",
    };
  }

  // XSS対策: メタデータ用にHTMLタグを除去
  const plainDescription = stripHtml(post.content).substring(0, 160);

  return generateArticleMetadata({
    title: post.title,
    description: plainDescription,
    publishedTime: post.date,
    modifiedTime: post.date, // 現在のPostTypeにはmodifiedがないためdateを使用
    imageUrl: post.featuredImage?.url || undefined,
    tags: [post.category.name],
    slug: params.slug,
  });
}

// Replace getStaticPaths with generateStaticParams
// TEMPORARY: WordPress取得をスキップ（MDXプレビュー用）
export async function generateStaticParams() {
  // const paths = await PostService.getAllSlugList();
  // return paths;
  return []; // 空配列を返してビルド時の静的生成をスキップ
}

export default async function Post({ params }: { params: { slug: string } }) {
  const post = await PostService.getOne({ id: params.slug });

  if (!post) {
    notFound();
  }

  // XSS対策: DOMPurifyでHTMLをサニタイズ
  const sanitizedContent = sanitizeHtml(post.content);

  // JSON-LD構造化データ
  const articleSchema = generateArticleSchema({
    title: post.title,
    description: stripHtml(post.content).substring(0, 160),
    publishedTime: post.date,
    modifiedTime: post.date, // 現在のPostTypeにはmodifiedがないためdateを使用
    imageUrl: post.featuredImage?.url || undefined,
    slug: params.slug,
  });

  return (
    <Layout>
      {/* JSON-LD構造化データ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
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
          <div dangerouslySetInnerHTML={{ __html: sanitizedContent }}></div>
        </article>
      </div>
    </Layout>
  );
}
