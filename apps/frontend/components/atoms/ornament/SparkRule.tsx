export const SparkRule = ({
  width = '2.5em',
  className = '',
}: {
  width?: string;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={`block h-[2px] bg-accent-yellow-deep ${className}`}
    style={{ width }}
  />
);

export default SparkRule;
