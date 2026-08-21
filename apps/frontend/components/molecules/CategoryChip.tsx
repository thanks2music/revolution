import Link from 'next/link';

type Props = {
  name: string;
  href?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  /**
   * 該当件数 (Claude Design v6 #17/#18)。渡すとラベルの後ろに並ぶ。
   *
   * ⚠️ **0 は渡さない想定**。作品配下の記事一覧は「記事 0 件のカテゴリは
   *    チップを出さない」(生成側と集合を共有) 方針なので、0 のチップは
   *    そもそも描かれない。ここでは 0 も素直に表示する (隠すと呼び出し側の
   *    バグが見えなくなる)。
   */
  count?: number;
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
} as const;

const baseStyles =
  'inline-flex items-center font-display tracking-wide rounded-full transition-colors';

const inactiveStyles =
  'bg-bg-tinted text-primary-700 border border-primary-300/60 hover:border-primary-500';

const activeStyles =
  'bg-primary-500 text-white border border-primary-500';

export const CategoryChip = ({ name, href, active = false, size = 'sm', count }: Props) => {
  const className = `${baseStyles} ${sizeStyles[size]} ${active ? activeStyles : inactiveStyles}`;
  const content =
    count === undefined ? (
      name
    ) : (
      <>
        {name}
        {/* 件数は数字用フォント + tabular-nums で桁を揃える (チップの幅が跳ねない)。 */}
        <span className="ml-1 font-numeric tabular-nums">{count}</span>
      </>
    );

  if (href) {
    return (
      <Link href={href} className={className} aria-current={active ? 'page' : undefined}>
        {content}
      </Link>
    );
  }
  return <span className={className}>{content}</span>;
};

export default CategoryChip;
