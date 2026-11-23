/**
 * Detected links: links the WEB checker found newly appearing on a watched page and handed over
 * for the scheduled run to try (`@revolution/schemas/detected-link`).
 *
 * The WEB checker's Functions write them with status `pending`; the scheduled run reads the
 * pending ones and marks each `tried` (after trying it) or `expired` (30 days after detection,
 * never tried). Only the Admin SDK reads and writes the collection; `firestore.rules` has no rule
 * for it. The document ID is the same as the attempt record's, so whether a link was already
 * tried is answered by the attempt record, as for registered URLs.
 *
 * Pending links are read with an equality filter only and ordered in memory, so no composite
 * index is needed. The pending set stays small: every link leaves it after one try or 30 days.
 *
 * @module lib/scheduled/detected-link-store
 */
import type { Firestore } from 'firebase-admin/firestore';

import { attemptDocId } from '@revolution/net/attempt-url';
import {
  DETECTED_LINKS_COLLECTION,
  DetectedLinkSchema,
  type DetectedLink,
  type DetectedLinkStatus,
} from '@revolution/schemas/detected-link';

/** Firestore allows 500 writes in one batch */
const BATCH_LIMIT = 500;

export class DetectedLinkStore {
  constructor(private readonly db: Firestore) {}

  /** Links not tried yet. A document that does not match the schema is left out (and logged) */
  async listPending(log: (message: string) => void = () => {}): Promise<DetectedLink[]> {
    const snapshot = await this.db.collection(DETECTED_LINKS_COLLECTION).where('status', '==', 'pending').get();
    const links: DetectedLink[] = [];
    for (const doc of snapshot.docs) {
      const parsed = DetectedLinkSchema.safeParse(doc.data());
      if (parsed.success) links.push(parsed.data);
      else log(`  読めない検知リンクを飛ばしました: ${doc.id}`);
    }
    return links;
  }

  /** Set the status of the given normalized URLs (a link deleted in the meantime is skipped) */
  async mark(urls: string[], status: Exclude<DetectedLinkStatus, 'pending'>): Promise<void> {
    const unique = [...new Set(urls)];
    for (let start = 0; start < unique.length; start += BATCH_LIMIT) {
      const refs = unique
        .slice(start, start + BATCH_LIMIT)
        .map(url => this.db.collection(DETECTED_LINKS_COLLECTION).doc(attemptDocId(url)));
      // `update` fails on a missing document and would fail the whole batch, so read first
      const existing = (await this.db.getAll(...refs)).filter(snapshot => snapshot.exists);
      if (existing.length === 0) continue;
      const batch = this.db.batch();
      for (const snapshot of existing) batch.update(snapshot.ref, { status });
      await batch.commit();
    }
  }
}
