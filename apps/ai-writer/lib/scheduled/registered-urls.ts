/**
 * What the admin UI does with registered URLs (decided 2026-11-15).
 *
 * - Register: a URL that was already tried (by RSS, the CLI or an earlier registration) is not
 *   registered again; its existing result is shown instead.
 * - List: each registered URL with what happened to it, read from the attempt record. A URL
 *   without a record has not been tried yet.
 * - Remove: the registration goes; the attempt record stays, so the URL is not tried (and paid
 *   for) again if someone registers it later. A URL still waiting for a retry is given up.
 *
 * @module lib/scheduled/registered-urls
 */
import type { AttemptRecord, AttemptStore } from './attempt-store';
import { normalizeAttemptUrl } from './attempt-url';
import { AlreadyRegisteredError, type RegisteredUrl, type RegisteredUrlStore } from './registered-url-store';

export const UNREGISTERED_REASON = '登録を取り消したため打ち切りました';

export interface RegisteredUrlDeps {
  registered: Pick<RegisteredUrlStore, 'list' | 'get' | 'add' | 'remove'>;
  attempts: Pick<AttemptStore, 'get' | 'getMany' | 'save'>;
  /**
   * Throws when the host is (or resolves to) an internal address (`assertPublicHost`).
   * The job fetches registered URLs, so an internal address must not get in
   */
  assertPublicHost: (url: URL) => Promise<void>;
}

export interface RegisteredUrlWithResult extends RegisteredUrl {
  /** What happened to the URL; absent until the scheduled run tries it */
  attempt?: AttemptRecord;
}

export type RegisterResult =
  | { kind: 'registered'; registered: RegisteredUrl }
  | { kind: 'invalid'; message: string }
  /** Tried before: not registered, the earlier result is returned */
  | { kind: 'already-attempted'; attempt: AttemptRecord }
  | { kind: 'already-registered' };

/**
 * The URL the scheduled run would fetch, or `undefined` when the input is not an http(s) URL.
 * Google redirect URLs are unwrapped and tracking parameters removed (`attempt-url.ts`).
 */
export function parseRegisteredUrl(input: string): string | undefined {
  const normalized = normalizeAttemptUrl(input);
  try {
    const url = new URL(normalized);
    return url.protocol === 'http:' || url.protocol === 'https:' ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export async function listRegisteredUrls(deps: RegisteredUrlDeps): Promise<RegisteredUrlWithResult[]> {
  const registered = await deps.registered.list();
  const attempts = await deps.attempts.getMany(registered.map(entry => entry.url));
  return registered.map(entry => ({ ...entry, attempt: attempts.get(entry.url) }));
}

export async function registerUrl(
  deps: RegisteredUrlDeps,
  input: string,
  createdBy: string,
  now: Date,
): Promise<RegisterResult> {
  const url = parseRegisteredUrl(input);
  if (!url) return { kind: 'invalid', message: 'http または https の URL を入力してください' };
  try {
    await deps.assertPublicHost(new URL(url));
  } catch {
    return { kind: 'invalid', message: '内部のアドレスや、名前を解決できないホストの URL は登録できません' };
  }

  const attempt = await deps.attempts.get(url);
  if (attempt) return { kind: 'already-attempted', attempt };

  try {
    return { kind: 'registered', registered: await deps.registered.add(url, createdBy, now) };
  } catch (error) {
    if (error instanceof AlreadyRegisteredError) return { kind: 'already-registered' };
    throw error;
  }
}

/** @returns `false` when there was no such registration */
export async function unregisterUrl(deps: RegisteredUrlDeps, id: string): Promise<boolean> {
  const entry = await deps.registered.get(id);
  if (!entry) return false;

  const attempt = await deps.attempts.get(entry.url);
  // A URL waiting for a retry would otherwise keep being tried after the registration is gone.
  // The job writes the whole record when it tries a URL, so a removal during a run can be
  // overwritten by that run's result; the URL then follows its retry schedule as before
  if (attempt && (attempt.status === 'waiting-details' || attempt.status === 'retrying-failure')) {
    await deps.attempts.save({ ...attempt, status: 'given-up', nextAttemptAt: null, givenUpReason: UNREGISTERED_REASON });
  }
  await deps.registered.remove(id);
  return true;
}
