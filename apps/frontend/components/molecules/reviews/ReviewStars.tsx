/** 星 5 つ (塗った数 = rating を四捨五入)。読み上げには「5 つ星中 4.2」と伝える */
export function ReviewStars({ rating, className = '' }: { rating: number; className?: string }) {
  const filled = Math.round(rating);
  return (
    <span role="img" aria-label={`5 つ星中 ${rating}`} className={`tracking-wider ${className}`}>
      <span aria-hidden="true" className="text-accent-yellow-deep">
        {'★'.repeat(filled)}
      </span>
      <span aria-hidden="true" className="text-(--line-strong)">
        {'★'.repeat(5 - filled)}
      </span>
    </span>
  );
}
