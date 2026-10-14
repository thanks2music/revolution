import Link from 'next/link';
import { MDXRemote, MDXRemoteProps } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import { ArticleImage } from '@/components/molecules/ArticleImage';
import { ArticlePoints } from '@/components/molecules/ArticlePoints';

/**
 * カスタムリンクコンポーネント
 * 内部リンクはNext.js Linkを使用、外部リンクは通常のaタグ
 */
function CustomLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const href = props.href;

  if (href?.startsWith('/')) {
    return (
      <Link href={href} {...props}>
        {props.children}
      </Link>
    );
  }

  if (href?.startsWith('#')) {
    return <a {...props} />;
  }

  return <a target="_blank" rel="noopener noreferrer" {...props} />;
}

/**
 * カスタムコードブロック
 */
function Code({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  // インラインコード
  if (!className) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm font-mono" {...props}>
        {children}
      </code>
    );
  }

  // コードブロック
  return (
    <code className={`block p-4 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-x-auto ${className}`} {...props}>
      {children}
    </code>
  );
}

/**
 * カスタムpre要素
 */
function Pre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  return (
    <pre className="my-4 overflow-x-auto" {...props}>
      {children}
    </pre>
  );
}

/**
 * MDXコンポーネントのマッピング
 * Atomic Designの既存コンポーネントをここに追加可能
 */
const components = {
  a: CustomLink,
  // 画像: Markdown の `![alt](src)` は img、AI Writer が寸法を書く画像は `<ArticleImage>`。
  // MDX の components は JSX で直接書いた小文字の `<img>` には効かないため、寸法付きの画像は大文字の部品で書く
  img: ArticleImage,
  ArticleImage,
  ArticlePoints,
  code: Code,
  pre: Pre,
  // 見出し
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="text-4xl font-bold mt-8 mb-4" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-3xl font-semibold mt-6 mb-3" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-2xl font-semibold mt-5 mb-2" {...props} />
  ),
  h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 className="text-xl font-semibold mt-4 mb-2" {...props} />
  ),
  // 段落
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="my-4 leading-7 text-gray-700 dark:text-gray-300" {...props} />
  ),
  // リスト
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="my-4 ml-6 list-disc space-y-2" {...props} />
  ),
  ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol className="my-4 ml-6 list-decimal space-y-2" {...props} />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li className="leading-7" {...props} />
  ),
  // 引用
  blockquote: (props: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="my-4 pl-4 border-l-4 border-gray-300 dark:border-gray-600 italic text-gray-600 dark:text-gray-400" {...props} />
  ),
  // 水平線
  hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="my-8 border-gray-300 dark:border-gray-700" {...props} />
  ),
  // テーブル: 見た目と横スクロールの枠 (article-table-scroll) は styles/globals.css の .article-content
  // (AI Writer が HTML で書く表も同じ枠を自分で付ける。見た目を揃えるため)
  table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="article-table-scroll">
      <table {...props} />
    </div>
  ),
};

/**
 * カスタムMDXコンポーネント
 * next-mdx-remote/rsc を使用してMDXをレンダリング
 *
 * ★2026-08-16: remark-gfm を追加。
 *   上の components に table / thead / tbody / tr / th / td のスタイルが定義済み
 *   だったにもかかわらず plugin が未配線で、AI Writer が出力する「まとめテーブル」
 *   (| 項目 | 内容 | 形式) が 1 行のパイプ文字列としてそのまま表示されていた。
 *   GFM は表のほかに打ち消し線・タスクリスト・自動リンクも有効にする。
 *   (2026-10-15: 表の見た目は components から styles/globals.css の .article-content へ移した)
 */
export function CustomMDX(props: MDXRemoteProps) {
  return (
    <MDXRemote
      {...props}
      components={{ ...components, ...(props.components || {}) }}
      options={{
        ...props.options,
        mdxOptions: {
          ...props.options?.mdxOptions,
          remarkPlugins: [remarkGfm, ...(props.options?.mdxOptions?.remarkPlugins ?? [])],
        },
      }}
    />
  );
}

export default CustomMDX;
