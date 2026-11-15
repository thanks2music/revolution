/**
 * URLs registered by hand from the admin UI, for the scheduled run to try first
 * (decided 2026-11-15).
 *
 * Collection `scheduled_registered_urls`. The document holds only the URL, who registered it and
 * when. What happened to the URL is in the attempt record (`attempt-store.ts`), which uses the
 * same document ID (the SHA-256 of the normalized URL), so a URL cannot be registered twice and
 * the two are joined without a query. A registered URL that has no attempt record yet is one the
 * scheduled run has not tried.
 *
 * Only the Admin SDK reads and writes it (the job, and the admin UI's API routes behind
 * `requireAuth`); `firestore.rules` has no rule for it, so a browser cannot reach it directly.
 *
 * @module lib/scheduled/registered-url-store
 */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { attemptDocId } from './attempt-url';

export const REGISTERED_URLS_COLLECTION = 'scheduled_registered_urls';

export interface RegisteredUrl {
  /** The document ID (`attemptDocId(url)`) */
  id: string;
  /** Normalized URL (`normalizeAttemptUrl`) */
  url: string;
  /** The email address of the person who registered it */
  createdBy: string;
  createdAt: Date;
}

function fromFirestore(id: string, data: Record<string, unknown>): RegisteredUrl {
  const createdAt = data.createdAt;
  return {
    id,
    url: String(data.url ?? ''),
    createdBy: String(data.createdBy ?? ''),
    createdAt: createdAt instanceof Timestamp ? createdAt.toDate() : new Date(0),
  };
}

/** Firestore's ALREADY_EXISTS, returned by `create` when the document exists */
const ALREADY_EXISTS = 6;

export class RegisteredUrlStore {
  constructor(private readonly db: Firestore) {}

  private collection() {
    return this.db.collection(REGISTERED_URLS_COLLECTION);
  }

  /** Every registered URL, the oldest first */
  async list(): Promise<RegisteredUrl[]> {
    const snapshot = await this.collection().orderBy('createdAt', 'asc').get();
    return snapshot.docs.map(doc => fromFirestore(doc.id, doc.data()));
  }

  async get(id: string): Promise<RegisteredUrl | undefined> {
    const snapshot = await this.collection().doc(id).get();
    return snapshot.exists ? fromFirestore(snapshot.id, snapshot.data() ?? {}) : undefined;
  }

  /**
   * Register a normalized URL. `create` fails when the document exists, so two people
   * registering the same URL at once cannot both succeed.
   *
   * @returns `undefined` when the URL is already registered
   */
  async add(url: string, createdBy: string, now: Date): Promise<RegisteredUrl | undefined> {
    const id = attemptDocId(url);
    try {
      await this.collection().doc(id).create({ url, createdBy, createdAt: Timestamp.fromDate(now) });
    } catch (error) {
      if ((error as { code?: unknown }).code === ALREADY_EXISTS) return undefined;
      throw error;
    }
    return { id, url, createdBy, createdAt: now };
  }

  async remove(id: string): Promise<void> {
    await this.collection().doc(id).delete();
  }
}
