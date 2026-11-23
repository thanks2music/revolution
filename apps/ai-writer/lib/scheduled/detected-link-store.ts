/**
 * Detected links: links the WEB checker found newly appearing on a watched page and handed over
 * for the scheduled run to try (`@revolution/schemas/detected-link`).
 *
 * The WEB checker's Functions write them; the scheduled run only reads them. There is no status:
 * whether a link was tried is answered by the attempt record, which has the same document ID (as
 * for registered URLs), and a link detected more than 30 days ago is no longer read. Documents are
 * kept. Only the Admin SDK reads and writes the collection; `firestore.rules` has no rule for it.
 *
 * @module lib/scheduled/detected-link-store
 */
import type { Firestore } from 'firebase-admin/firestore';

import { DAY_MS } from '@/lib/utils/date';
import {
  DETECTED_LINK_TTL_DAYS,
  DETECTED_LINKS_COLLECTION,
  DetectedLinkSchema,
  type DetectedLink,
} from '@revolution/schemas/detected-link';

export class DetectedLinkStore {
  constructor(private readonly db: Firestore) {}

  /**
   * Links detected within the last 30 days (a range on one field, so the automatic single-field
   * index is enough). A document that does not match the schema is left out and logged
   */
  async listRecent(now: Date, log: (message: string) => void = () => {}): Promise<DetectedLink[]> {
    const cutoff = now.getTime() - DETECTED_LINK_TTL_DAYS * DAY_MS;
    const snapshot = await this.db.collection(DETECTED_LINKS_COLLECTION).where('detectedAt', '>=', cutoff).get();
    const links: DetectedLink[] = [];
    for (const doc of snapshot.docs) {
      const parsed = DetectedLinkSchema.safeParse(doc.data());
      if (parsed.success) links.push(parsed.data);
      else log(`  読めない検知リンクを飛ばしました: ${doc.id}`);
    }
    return links;
  }
}
