/**
 * Layer 1: telling "the official page names no work" apart from other extraction failures.
 * The pipeline makes it a skip (not retried), so the type must survive the wrappers.
 */
import { describe, expect, it } from '@jest/globals';

import { isMissingWorkTitle, MissingWorkTitleError } from '@/lib/services/extraction.service';

describe('isMissingWorkTitle', () => {
  it('finds the error through the wrappers (parse, then extraction)', () => {
    const parse = new Error('Failed to parse extraction response: x', { cause: new MissingWorkTitleError() });
    const extraction = new Error('情報抽出失敗: x', { cause: parse });
    expect(isMissingWorkTitle(extraction)).toBe(true);
  });

  it('keeps the message the logs and Slack used before', () => {
    expect(new MissingWorkTitleError().message).toBe('Missing required field: 作品名 (or works[].title with is_primary)');
  });

  it.each([
    ['another missing field', new Error('情報抽出失敗', { cause: new Error('Missing required field: 店舗名 (or store.name)') })],
    ['an AI outage', new Error('情報抽出失敗: 503')],
    ['not an error', 'Missing required field: 作品名'],
    ['nothing', undefined],
  ])('is false for %s', (_, value) => {
    expect(isMissingWorkTitle(value)).toBe(false);
  });
});
