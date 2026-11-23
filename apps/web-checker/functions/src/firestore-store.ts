import type { Firestore } from 'firebase-admin/firestore';

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
      await snapshots(targetId).add(snapshot);
    },
    async markChecked(targetId, checkedAt) {
      // 監視対象が見回りの途中で消されていたら、書き戻して復活させない
      try {
        await targetRef(targetId).update({ checkedAt });
      } catch (error) {
        if ((error as { code?: number }).code === 5) return; // NOT_FOUND
        throw error;
      }
    },
  };
}
