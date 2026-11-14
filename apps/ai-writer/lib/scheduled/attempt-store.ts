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
import type { AttemptStatus, OutcomeKind } from './retry-policy';
import { attemptDocId } from './attempt-url';

export const ATTEMPTS_COLLECTION = 'scheduled_url_attempts';

/** Who tried the URL first */
export type AttemptSource = 'rss' | 'cli';

/** Where `publishedAt` came from */
export type PublishedAtSource = PublishedDateSource | 'rss' | 'first-attempt';

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

  /** Which of the given normalized URLs already have a record (one batched read) */
  async findAttempted(urls: string[]): Promise<Set<string>> {
    const unique = [...new Set(urls)];
    if (unique.length === 0) return new Set();
    const snapshots = await this.db.getAll(...unique.map(url => this.ref(url)));
    return new Set(
      snapshots.filter(s => s.exists).map(s => String((s.data() as { url?: unknown }).url ?? '')),
    );
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

  async save(record: AttemptRecord): Promise<void> {
    await this.ref(record.url).set(toFirestore(record));
  }
}
