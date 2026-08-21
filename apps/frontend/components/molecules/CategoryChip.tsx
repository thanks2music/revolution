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

/*
 * 🔶 2026-08-22: 地を `--primary-500` (#3fb5f0) から `--primary-strong` (#1a6fa3)
 *    へ変更した。旧値は白文字とのコントラストが **2.31:1** で WCAG AA を大きく
 *    割っていた (Codex レビュー #334 指摘、実測で確認)。現値は 5.46:1。
 *
 *    `--primary-strong` は globals.css で「白文字を載せる塗り専用の濃色」として
 *    既に定義済みのトークンなので、新規追加ではなく本来の用途への是正である。
 *    v6 #17/#18 で active チップに件数まで乗ったため、可読性の要求はむしろ上がった。
 */
const activeStyles = 'bg-primary-strong text-white border border-primary-strong';

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
