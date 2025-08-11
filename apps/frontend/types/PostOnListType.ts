import FeaturedImageType from "./FeaturedImageType";
import CategoryType from "./CategoryType";
interface PostOnListType {
  id: string;
  title: string;
  slug: string;
  date: string;
  excerpt: string;
  featuredImage: FeaturedImageType; // 現状はstringでもいいけど、今後項目が増えた時のために
  category: CategoryType; // SEO的にカテゴリーを複数にしないので単数の前提で
}

export default PostOnListType;
