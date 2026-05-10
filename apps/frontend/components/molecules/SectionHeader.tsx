import { SparkRule } from '@/components/atoms/ornament/SparkRule';

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Right-aligned slot — e.g. "View all" link */
  action?: React.ReactNode;
  /** Title heading level. Default: h2 */
  level?: 'h1' | 'h2' | 'h3';
};

export const SectionHeader = ({
  eyebrow,
  title,
  subtitle,
  action,
  level = 'h2',
}: Props) => {
  const Heading = level;
  return (
    <header className="mb-8 flex flex-col gap-1 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="flex-1">
        {eyebrow && (
          <p className="font-numeric tabular-nums text-xs tracking-[0.18em] text-ink-muted uppercase">
            {eyebrow}
          </p>
        )}
        <SparkRule className="mt-1.5 mb-3" width="2em" />
        <Heading className="font-display text-3xl text-ink-strong md:text-4xl">{title}</Heading>
        {subtitle && (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted md:text-base">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 self-start md:self-end">{action}</div>}
    </header>
  );
};

export default SectionHeader;
