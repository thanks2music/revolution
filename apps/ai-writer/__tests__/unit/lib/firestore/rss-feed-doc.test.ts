/**
 * Layer 1: an rss_feeds document read the same way by the admin API and the scheduled job.
 */
import { describe, expect, it } from '@jest/globals';

import { rssFeedFromDoc } from '@/lib/firestore/rss-feed-doc';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('rssFeedFromDoc', () => {
  it('maps the fields and the timestamps', () => {
    expect(
      rssFeedFromDoc('f1', {
        url: 'https://example.com/feed',
        title: 'コラボカフェ',
        isActive: true,
        validationConfig: null,
        createdAt: ts('2025-10-29T00:00:00Z'),
        updatedAt: ts('2026-11-15T00:00:00Z'),
        lastFetchedAt: null,
        createdBy: 'uid',
      }),
    ).toEqual({
      id: 'f1',
      url: 'https://example.com/feed',
      title: 'コラボカフェ',
      description: undefined,
      siteUrl: undefined,
      isActive: true,
      validationConfig: undefined,
      lastFetchedAt: undefined,
      createdAt: new Date('2025-10-29T00:00:00Z'),
      updatedAt: new Date('2026-11-15T00:00:00Z'),
      createdBy: 'uid',
    });
  });

  it('falls back to the epoch when a timestamp is missing', () => {
    expect(rssFeedFromDoc('f2', { url: 'u', isActive: false, createdBy: 'uid' }).createdAt).toEqual(new Date(0));
  });
});
