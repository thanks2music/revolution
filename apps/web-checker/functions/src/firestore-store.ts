import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { attemptDocId } from '@revolution/net/attempt-url';

import type { TargetStore } from './crawl';
import {
  DETECTED_LINKS_COLLECTION,
  SNAPSHOTS_SUBCOLLECTION,
  TARGETS_COLLECTION,
  type DetectedLink,
  type Snapshot,
  type Target,
} from './targets';

/** `TargetStore` の Firestore 版 (Admin SDK。rules を通らない) */
export function createFirestoreStore(db: Firestore): TargetStore {
  const targetRef = (targetId: string) => db.collection(TARGETS_COLLECTION).doc(targetId);
  const snapshots = (targetId: string) => targetRef(targetId).collection(SNAPSHOTS_SUBCOLLECTION);

  return {
    async getTarget(targetId) {
      const doc = await targetRef(targetId).get();
      return doc.exists ? (doc.data() as Target) : null;
    },
    async getLatestSnapshot(targetId) {
      const result = await snapshots(targetId).orderBy('time', 'desc').limit(1).get();
      return result.empty ? null : (result.docs[0].data() as Snapshot);
    },
    async addSnapshot(targetId, snapshot) {
      // 監視対象があることを確かめてから足す。見回りの途中で消された時に、履歴だけ残らないように
      return db.runTransaction(async (transaction) => {
        const target = await transaction.get(targetRef(targetId));
        if (!target.exists) return false;
        transaction.create(snapshots(targetId).doc(), snapshot);
        return true;
      });
    },
    async addDetectedLinks(links) {
      const results = await Promise.all(
        links.map(async (link): Promise<DetectedLink | null> => {
          try {
            await db.collection(DETECTED_LINKS_COLLECTION).doc(attemptDocId(link.url)).create(link);
            return link;
          } catch (error) {
            // 同じ URL がもう記録されている (ALREADY_EXISTS)。先に検知した方を残す
            if ((error as { code?: number }).code === 6) return null;
            throw error;
          }
        }),
      );
      return results.filter((link): link is DetectedLink => link !== null);
    },
    async recordCheck(targetId, record) {
      const update: Record<string, unknown> = { checkedAt: record.checkedAt };
      if (record.alertedAt === null) update.alertedAt = FieldValue.delete();
      else if (record.alertedAt !== undefined) update.alertedAt = record.alertedAt;
      try {
        await targetRef(targetId).update(update);
      } catch (error) {
        // 監視対象が見回りの途中で消されていたら、書き戻して復活させない (NOT_FOUND)
        if ((error as { code?: number }).code === 5) return;
        throw error;
      }
    },
  };
}
