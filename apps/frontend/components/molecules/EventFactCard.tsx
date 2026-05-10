import { StatusBadge, type EventStatus } from '@/components/atoms/badge/StatusBadge';
import type { ArticleIndexItem } from '@/lib/mdx/articles';

type Props = {
  article: ArticleIndexItem;
};

/**
 * Parse a `YYYY-MM-DD` string as a local-date Date.
 * `new Date("YYYY-MM-DD")` parses as UTC midnight, which causes the date to
 * shift by up to a day in JST (UTC+9) — events would appear `coming-soon`
 * until 09:00 JST on the start day. Parsing the components into a local
 * Date keeps the comparison and the formatted output on the same calendar
 * day for the visitor's locale.
 */
const parseLocalDate = (iso: string): Date | null => {
  const trimmed = iso.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

/** Allow only http(s) hrefs to defuse `javascript:` / `data:` XSS vectors. */
const isSafeHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url.trim());

const computeStatus = (
  start?: string,
  end?: string
): { status: EventStatus; daysLeft?: number } => {
  if (!start || !end) return { status: 'unknown' };
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  if (!startDate || !endDate) return { status: 'unknown' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = 86_400_000;
  if (today < startDate) {
    return { status: 'coming-soon', daysLeft: Math.ceil((startDate.getTime() - today.getTime()) / ms) };
  }
  if (today <= endDate) return { status: 'now' };
  return { status: 'ended' };
};

const formatPeriod = (start?: string, end?: string): string | null => {
  if (!start || !end) return null;
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e) return null;
  const fmt = (d: Date) =>
    d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });
  return `${fmt(s)} 〜 ${fmt(e)}`;
};

/**
 * 記事詳細ヒーロー直下の Sticky FactCard。
 * sticky 動作は呼び出し側で `md:sticky md:top-6 md:self-start` を付与する。
 */
export const EventFactCard = ({ article }: Props) => {
  const { status, daysLeft } = computeStatus(article.event_start_date, article.event_end_date);
  const period = formatPeriod(article.event_start_date, article.event_end_date);
  const officialUrl = article.official_url && isSafeHttpUrl(article.official_url)
    ? article.official_url
    : undefined;

  const rows: Array<{ label: string; value: React.ReactNode; mono?: boolean; emphasis?: boolean }> = [
    article.work_title ? { label: '作品', value: article.work_title, emphasis: true } : null,
    article.event_title ? { label: 'タイプ', value: article.event_title } : null,
    period ? { label: '開催期間', value: period, mono: true } : null,
    article.venue ? { label: '開催場所', value: article.venue } : null,
    article.prefectures && article.prefectures.length > 0
      ? { label: '都道府県', value: article.prefectures.join(' · ') }
      : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <aside
      aria-label="イベント概要"
      className="bg-bg-elevated border border-[var(--line-soft)] p-5 md:p-6"
    >
      <p className="font-numeric tabular-nums mb-3 text-[10px] tracking-[0.22em] text-ink-muted uppercase">
        Event Fact
      </p>

      <StatusBadge status={status} daysLeft={daysLeft} className="mb-5" />

      <dl className="space-y-3.5 text-sm">
        {rows.map(({ label, value, mono, emphasis }) => (
          <div key={label}>
            <dt className="text-xs text-ink-muted mb-0.5">{label}</dt>
            <dd
              className={[
                emphasis ? 'font-display text-base text-ink-strong' : 'text-ink-body',
                mono ? 'font-numeric tabular-nums' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {value}
            </dd>
          </div>
        ))}
        {officialUrl && (
          <div className="pt-2">
            <a
              href={officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display inline-flex items-center gap-1 text-sm text-primary-600 transition-colors hover:text-primary-700"
            >
              公式サイト ↗
            </a>
          </div>
        )}
      </dl>

      {status === 'unknown' && (
        <p className="mt-5 border-t pt-4 text-xs leading-relaxed text-ink-muted">
          開催期間・場所の詳細は本文をご確認ください。
        </p>
      )}
    </aside>
  );
};

export default EventFactCard;
