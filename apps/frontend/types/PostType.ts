import FeaturedImageType from "./FeaturedImageType";
import CategoryType from "./CategoryType";

interface PostType {
  id: string;
  title: string;
  slug: string;
  date: string;
  content: string; // ココが違う！！！
  featuredImage: FeaturedImageType;
  category: CategoryType;
}

export default PostType;
