/**
 * Turn an `rss_feeds` document into `RssFeed` (server side, Admin SDK).
 * Shared by the admin API and the scheduled job, so both read a feed the same way.
 *
 * @module lib/firestore/rss-feed-doc
 */
import type { RssFeed } from '../types/rss-feed';

interface TimestampLike {
  toDate(): Date;
}

export function rssFeedFromDoc(id: string, data: Record<string, unknown>): RssFeed {
  const date = (value: unknown) => (value as TimestampLike | undefined)?.toDate?.();
  return {
    id,
    url: data.url as string,
    title: data.title as string | undefined,
    description: data.description as string | undefined,
    siteUrl: data.siteUrl as string | undefined,
    isActive: data.isActive as boolean,
    validationConfig: (data.validationConfig as RssFeed['validationConfig']) || undefined,
    lastFetchedAt: date(data.lastFetchedAt),
    createdAt: date(data.createdAt) ?? new Date(0),
    updatedAt: date(data.updatedAt) ?? new Date(0),
    createdBy: data.createdBy as string,
  };
}
