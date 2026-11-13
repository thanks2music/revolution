/**
 * Layer 1: whether a run stops because the event already has an article.
 *
 * The PR state is no longer consulted, so merged, open and closed PRs all lead to a skip
 * as long as the record says `generated`.
 */
import { describe, expect, it } from '@jest/globals';
import { existingEventSkipReason } from '@/lib/firestore/existing-event-skip';
import type { DuplicationCheckResult, EventCanonicalKey } from '@/lib/firestore/types';

const canonicalKey = 'sample-work:sample-store:collabo-cafe:2026';

function doc(status: EventCanonicalKey['status']): EventCanonicalKey {
  return {
    canonicalKey,
    postId: '01k0000000000000000000000a',
    workSlug: 'sample-work',
    storeSlug: 'sample-store',
    eventType: 'collabo-cafe',
    year: 2026,
    status,
    // Timestamps are not read by the function under test
    createdAt: null as never,
    updatedAt: null as never,
  };
}

describe('existingEventSkipReason', () => {
  it('skips when the record is generated, and names the key and post_id', () => {
    const check: DuplicationCheckResult = {
      isDuplicate: true,
      existingDoc: doc('generated'),
      canonicalKey,
    };

    const reason = existingEventSkipReason(check);

    expect(reason).toContain(canonicalKey);
    expect(reason).toContain('01k0000000000000000000000a');
    expect(reason).toContain('--update');
  });

  it('does not skip when there is no record', () => {
    expect(existingEventSkipReason({ isDuplicate: false, canonicalKey })).toBeUndefined();
  });

  it.each(['pending', 'failed', 'retryable'] as const)(
    'does not skip a %s record (it may be overwritten)',
    (status) => {
      const check: DuplicationCheckResult = {
        isDuplicate: false,
        existingDoc: doc(status),
        canonicalKey,
      };

      expect(existingEventSkipReason(check)).toBeUndefined();
    }
  );

  it('does not skip when isDuplicate is set without a document (defensive)', () => {
    expect(existingEventSkipReason({ isDuplicate: true, canonicalKey })).toBeUndefined();
  });
});
