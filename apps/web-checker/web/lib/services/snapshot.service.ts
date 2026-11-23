import {
  collection,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';

import { getFirebaseDb } from '@/lib/firebase/client';
import { SNAPSHOTS_SUBCOLLECTION, TARGETS_COLLECTION } from '@/lib/firestore/collections';
import { toSnapshot } from '@/lib/firestore/mappers';
import type { Snapshot } from '@/types/snapshot';

/**
 * 履歴 (`web_checker_targets/{id}/snapshots`) を読む。書くのは Functions だけなので、読む関数しか置かない。
 */

export interface SnapshotPage {
  items: Snapshot[];
  /** 次のページに渡すカーソル。もう無ければ null */
  nextCursorTime: number | null;
  hasMore: boolean;
}

export class SnapshotService {
  /** `time` の新しい順に 1 ページ読む。1 件が数十 KB になりうるので、ページは小さくする */
  static async listPage(
    targetId: string,
    params: { limit: number; cursorTime?: number }
  ): Promise<SnapshotPage> {
    const constraints = [
      orderBy('time', 'desc'),
      ...(params.cursorTime === undefined ? [] : [startAfter(params.cursorTime)]),
      limitTo(params.limit + 1),
    ];

    const snapshot = await getDocs(
      query(
        collection(getFirebaseDb(), TARGETS_COLLECTION, targetId, SNAPSHOTS_SUBCOLLECTION),
        ...constraints
      )
    );
    const all = snapshot.docs.map(entry => toSnapshot(entry.id, entry.data()));

    const hasMore = all.length > params.limit;
    const items = hasMore ? all.slice(0, params.limit) : all;

    return {
      items,
      hasMore,
      nextCursorTime: hasMore ? (items.at(-1)?.time ?? null) : null,
    };
  }
}
