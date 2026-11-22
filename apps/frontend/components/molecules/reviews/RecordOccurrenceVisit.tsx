'use client';

/** 開催のページを見たことを、7-0 の「最近見た開催」のために残す (one-more-time #166)。何も描かない */

import { useEffect } from 'react';

import { recordRecent } from '@/lib/reviews/recent-occurrences';

export function RecordOccurrenceVisit({ occurrenceId }: { occurrenceId: number }) {
  useEffect(() => {
    recordRecent(occurrenceId);
  }, [occurrenceId]);
  return null;
}
