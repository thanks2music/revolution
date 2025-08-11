import { WpGraphQlPostConst } from "../constants/WpGraphQlConst";
import Repository from "./Repository";

class PostRepository {
  // 新しくメソッドを作らず、既存のgetListで対応できるようにする
  static getList({ categoryId }: { categoryId?: number }) {
    // 引数のcategoryIdがあれば特定のカテゴリーに絞る
    if (categoryId) {
      return Repository(WpGraphQlPostConst.listByCategory, {
        variables: { categoryId },
      }).getWp();
    }
    // なければ今まで通り全記事取得
    return Repository(WpGraphQlPostConst.list).getWp();
  }

  static getOne({ id }: { id: string }) {
    return Repository(WpGraphQlPostConst.one, { variables: { id } }).getWp();
  }

  static getAllSlugList() {
    return Repository(WpGraphQlPostConst.allSlugList).getWp();
  }

  // 全カテゴリーのスラッグを取得
  static getAllCategorySlugList() {
    return Repository(WpGraphQlPostConst.allCategorySlugList).getWp();
  }

  // スラッグからカテゴリーIDを取得する
  static getCategoryIdBySlug({ slug }: { slug: string }) {
    return Repository(WpGraphQlPostConst.categoryIdBySlug, {
      variables: { id: slug },
    }).getWp();
  }
}

export default PostRepository;
