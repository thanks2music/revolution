/**
 * The record of URLs a scheduled run (or a `pnpm debug:mdx` run that makes a PR) has tried.
 *
 * Collection `scheduled_url_attempts`, one document per normalized URL (`attempt-url.ts`).
 * Only the Admin SDK writes it (the job and the CLI); `firestore.rules` gives the admin UI read
 * access only.
 *
 * @module lib/scheduled/attempt-store
 */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { PublishedDateSource } from './published-date';
import { isAwaitingRetry, type AttemptStatus, type OutcomeKind } from './retry-policy';
import { attemptDocId } from './attempt-url';

export const ATTEMPTS_COLLECTION = 'scheduled_url_attempts';

/** Where the URL came from when it was first tried */
export type AttemptSource = 'rss' | 'registered' | 'cli';

/** Where `publishedAt` came from */
export type PublishedAtSource = PublishedDateSource | 'rss' | 'registration' | 'first-attempt';

export interface AttemptRecord {
  url: string;
  source: AttemptSource;
  feedId?: string;
  title?: string;
  status: AttemptStatus;
  lastOutcome: OutcomeKind;
  /** The skip reason or the error of the last attempt */
  lastReason?: string;
  prUrl?: string;
  postId?: string;
  attemptCount: number;
  unannouncedCount: number;
  failureCount: number;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  nextAttemptAt: Date | null;
  publishedAt: Date;
  publishedAtSource: PublishedAtSource;
  /** `YYYY-MM-DD` once the event's start date is known */
  eventStartDate?: string;
  givenUpReason?: string;
}

const DATE_FIELDS = ['firstAttemptAt', 'lastAttemptAt', 'nextAttemptAt', 'publishedAt'] as const;

function toFirestore(record: AttemptRecord): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    // Firestore rejects `undefined`; a missing field is left out instead
    if (value === undefined) continue;
    data[key] = value instanceof Date ? Timestamp.fromDate(value) : value;
  }
  return data;
}

function fromFirestore(data: Record<string, unknown>): AttemptRecord {
  const record: Record<string, unknown> = { ...data };
  for (const key of DATE_FIELDS) {
    const value = data[key];
    record[key] = value instanceof Timestamp ? value.toDate() : (value ?? null);
  }
  return record as unknown as AttemptRecord;
}

export class AttemptStore {
  constructor(private readonly db: Firestore) {}

  private ref(url: string) {
    return this.db.collection(ATTEMPTS_COLLECTION).doc(attemptDocId(url));
  }

  async get(url: string): Promise<AttemptRecord | undefined> {
    const snapshot = await this.ref(url).get();
    return snapshot.exists ? fromFirestore(snapshot.data() ?? {}) : undefined;
  }

  /** The records of the given normalized URLs that have one, by URL (one batched read) */
  async getMany(urls: string[]): Promise<Map<string, AttemptRecord>> {
    const unique = [...new Set(urls)];
    if (unique.length === 0) return new Map();
    const snapshots = await this.db.getAll(...unique.map(url => this.ref(url)));
    const records = snapshots.filter(s => s.exists).map(s => fromFirestore(s.data() ?? {}));
    return new Map(records.map(record => [record.url, record]));
  }

  /** Which of the given normalized URLs already have a record */
  async findAttempted(urls: string[]): Promise<Set<string>> {
    return new Set((await this.getMany(urls)).keys());
  }

  /** Records whose retry is due, the longest-waiting first */
  async findDueRetries(now: Date, limit: number): Promise<AttemptRecord[]> {
    const snapshot = await this.db
      .collection(ATTEMPTS_COLLECTION)
      .where('nextAttemptAt', '<=', Timestamp.fromDate(now))
      .orderBy('nextAttemptAt')
      .limit(limit)
      .get();
    return snapshot.docs.map(doc => fromFirestore(doc.data()));
  }

  /**
   * Store the record, unless it would put a given-up URL back in the retry queue.
   *
   * A given-up URL is never tried again, so the only way to get there is a lost update: a run
   * that was trying the URL while its registration was removed (`unregisterUrl`). A PR or a skip
   * from that run is still stored. Read and write in one transaction so the check holds.
   *
   * @returns `false` when the record was not stored
   */
  async save(record: AttemptRecord): Promise<boolean> {
    const ref = this.ref(record.url);
    return this.db.runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (current.data()?.status === 'given-up' && isAwaitingRetry(record.status)) return false;
      transaction.set(ref, toFirestore(record));
      return true;
    });
  }
}
