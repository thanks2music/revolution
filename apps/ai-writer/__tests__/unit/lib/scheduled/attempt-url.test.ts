/**
 * Layer 1: the URL a scheduled run compares and stores.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { attemptDocId, normalizeAttemptUrl } from '@/lib/scheduled/attempt-url';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('normalizeAttemptUrl', () => {
  it('unwraps a Google Alerts redirect to the page it points to', () => {
    const alert =
      'https://www.google.com/url?rct=j&sa=t&url=https://example.com/news/1%3Futm_source%3Dalert&ct=ga&cd=abc&usg=xyz';
    expect(normalizeAttemptUrl(alert)).toBe('https://example.com/news/1');
  });

  it('drops utm_* and click IDs, and the fragment', () => {
    expect(
      normalizeAttemptUrl('https://example.com/a?id=3&utm_source=x&UTM_Medium=y&fbclid=f&gclid=g#top'),
    ).toBe('https://example.com/a?id=3');
  });

  it('leaves no lone ? when every parameter was tracking', () => {
    expect(normalizeAttemptUrl('https://example.com/a/?utm_campaign=c')).toBe('https://example.com/a/');
  });

  it('keeps the trailing slash, other parameters, the scheme and www as they are', () => {
    expect(normalizeAttemptUrl('http://www.example.com/a/?p=2')).toBe('http://www.example.com/a/?p=2');
    expect(normalizeAttemptUrl('https://example.com/a')).not.toBe(normalizeAttemptUrl('https://example.com/a/'));
  });

  it('returns a string that is not a URL trimmed but unchanged', () => {
    expect(normalizeAttemptUrl('  not a url ')).toBe('not a url');
  });
});

describe('attemptDocId', () => {
  it('is a stable hex digest without slashes', () => {
    const id = attemptDocId('https://example.com/a');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(attemptDocId('https://example.com/a')).toBe(id);
    expect(attemptDocId('https://example.com/b')).not.toBe(id);
  });
});
