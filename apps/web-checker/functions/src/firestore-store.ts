import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { attemptDocId } from '@revolution/net/attempt-url';
import { DETECTED_LINKS_COLLECTION } from '@revolution/schemas/detected-link';

import type { TargetStore } from './crawl';
import {
  SNAPSHOTS_SUBCOLLECTION,
  TARGETS_COLLECTION,
  type Snapshot,
  type Target,
} from './targets';

/** Firestore (gRPC) のエラーのコード */
const NOT_FOUND = 5;
const ALREADY_EXISTS = 6;

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
      const results = await Promise.allSettled(
        links.map((link) => db.collection(DETECTED_LINKS_COLLECTION).doc(attemptDocId(link.url)).create(link)),
      );
      const added: string[] = [];
      let failed = 0;
      let error: string | undefined;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          added.push(links[index].url);
          return;
        }
        // 同じ URL がもう記録されている。先に検知した方を残す
        if ((result.reason as { code?: number }).code === ALREADY_EXISTS) return;
        failed += 1;
        error ??= result.reason instanceof Error ? result.reason.message : String(result.reason);
      });
      return { links: added, failed, error };
    },
    async recordCheck(targetId, record) {
      const update: Record<string, unknown> = { checkedAt: record.checkedAt };
      if (record.alertedAt === null) update.alertedAt = FieldValue.delete();
      else if (record.alertedAt !== undefined) update.alertedAt = record.alertedAt;
      try {
        await targetRef(targetId).update(update);
      } catch (error) {
        // 監視対象が見回りの途中で消されていたら、書き戻して復活させない
        if ((error as { code?: number }).code === NOT_FOUND) return;
        throw error;
      }
    },
  };
}
