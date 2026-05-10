import Link from 'next/link';

type Props = {
  name: string;
  href?: string;
  active?: boolean;
  size?: 'sm' | 'md';
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

export const CategoryChip = ({ name, href, active = false, size = 'sm' }: Props) => {
  const className = `${baseStyles} ${sizeStyles[size]} ${active ? activeStyles : inactiveStyles}`;

  if (href) {
    return (
      <Link href={href} className={className} aria-pressed={active}>
        {name}
      </Link>
    );
  }
  return <span className={className}>{name}</span>;
};

export default CategoryChip;
