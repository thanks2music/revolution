import useSWR from "swr";
// const
import { WpGraphQlPostConst } from "../../constants/WpGraphQlConst";
// type
import PostType from "../../types/PostType";
// service
import PostService from "../../services/PostService";

const usePostSwr = ({
  id,
  staticPost,
}: {
  id: string;
  staticPost: PostType;
}) => {
  const { data: post } = useSWR(
    [WpGraphQlPostConst.list, id], //　Keyを配列にもできる
    ([_, id]: [string, string]) => PostService.getOne({ id }), // 使うのはidだけなので第一引数はアンダースコアに
    { fallbackData: staticPost }
  );
  return post;
};

export default usePostSwr;
