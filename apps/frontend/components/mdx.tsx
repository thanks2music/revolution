import Link from 'next/link';
import Image from 'next/image';
import { MDXRemote, MDXRemoteProps } from 'next-mdx-remote/rsc';

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
 * カスタム画像コンポーネント
 * Next.js Imageを使用して最適化
 */
function CustomImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  if (!props.src) {
    return null;
  }

  // 外部画像の場合はfillモードを使用
  if (typeof props.src === 'string' && props.src.startsWith('http')) {
    return (
      <span className="relative block w-full" style={{ minHeight: '400px' }}>
        <Image
          src={props.src}
          alt={props.alt || ''}
          fill
          className="object-contain"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
      </span>
    );
  }

  // ローカル画像の場合は通常のimgタグ
  return <img {...props} alt={props.alt || ''} />;
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
  img: CustomImage,
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
  // テーブル
  table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" {...props} />
    </div>
  ),
  thead: (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-gray-50 dark:bg-gray-800" {...props} />
  ),
  tbody: (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700" {...props} />
  ),
  tr: (props: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props} />
  ),
  th: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider" {...props} />
  ),
  td: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100" {...props} />
  ),
};

/**
 * カスタムMDXコンポーネント
 * next-mdx-remote/rsc を使用してMDXをレンダリング
 */
export function CustomMDX(props: Omit<MDXRemoteProps, 'components'>) {
  return (
    <MDXRemote
      {...props}
      components={{ ...components, ...(props.components || {}) }}
    />
  );
}

export default CustomMDX;
