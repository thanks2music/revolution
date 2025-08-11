import PostType from "../types/PostType";
import PostOnListType from "../types/PostOnListType";
import RepositoryFactory from "../repositories/RepositoryFactory";

class PostService {
  static async getList({
    categoryId,
  }: {
    categoryId?: number;
  }): Promise<PostOnListType[]> {
    try {
      const res = await RepositoryFactory.post.getList({ categoryId }); // 変更！
      return res.data.data.posts.edges.map((data: any) => {
        const post: PostOnListType = {
          id: data.node.id,
          title: data.node.title,
          slug: data.node.slug,
          date: data.node.date,
          excerpt: data.node.excerpt,
          featuredImage: {
            url: data.node.featuredImage.node.sourceUrl,
          },
          category: {
            slug: data.node.categories.edges[0].node.slug,
            name: data.node.categories.edges[0].node.name,
          },
        };
        return post;
      });
    } catch {
      return [];
    }
  }

  static async getOne({ id }: { id: string }): Promise<PostType | null> {
    try {
      const res = await RepositoryFactory.post.getOne({ id });
      const data = res.data.data.post;
      const post: PostType = {
        id: data.id,
        title: data.title,
        slug: data.slug,
        date: data.date,
        content: data.content,
        featuredImage: {
          url: data.featuredImage.node.sourceUrl,
        },
        category: {
          slug: data.categories.edges[0].node.slug,
          name: data.categories.edges[0].node.name,
        },
      };
      return post;
    } catch {
      return null;
    }
  }

  static async getAllSlugList(): Promise<
    {
      params: {
        slug: string;
      };
    }[]
  > {
    try {
      const res = await RepositoryFactory.post.getAllSlugList();
      return res.data.data.posts.edges.map((data: any) => {
        return { params: { slug: data.node.slug } };
      });
    } catch {
      return [];
    }
  }

  // 全カテゴリーのスラッグを取得（getAllSlugListに微妙にまとめにくので別メソッドを分ける）
  static async getAllCategorySlugList(): Promise<
    {
      params: {
        slug: string;
      };
    }[]
  > {
    try {
      const res = await RepositoryFactory.post.getAllCategorySlugList();
      return res.data.data.categories.edges.map((data: any) => {
        return { params: { slug: data.node.slug } };
      });
    } catch {
      return [];
    }
  }

  // スラッグからカテゴリーIDを取得する
  static async getCategoryIdBySlug({
    slug,
  }: {
    slug: string;
  }): Promise<number> {
    const res = await RepositoryFactory.post.getCategoryIdBySlug({ slug });
    return res.data.data.category.categoryId;
  }
}

export default PostService;
