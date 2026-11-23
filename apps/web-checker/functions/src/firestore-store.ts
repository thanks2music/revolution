import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import type { TargetStore } from './crawl';
import { SNAPSHOTS_SUBCOLLECTION, TARGETS_COLLECTION, type Snapshot, type Target } from './targets';

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
