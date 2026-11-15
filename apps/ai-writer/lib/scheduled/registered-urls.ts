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
import type { RegisteredUrl, RegisteredUrlStore } from './registered-url-store';

export const UNREGISTERED_REASON = '登録を取り消したため打ち切りました';

/** Longer input is not a page URL anyone registers by hand */
const MAX_URL_LENGTH = 2048;

export interface RegisteredUrlDeps {
  registered: Pick<RegisteredUrlStore, 'list' | 'get' | 'add' | 'remove'>;
  attempts: Pick<AttemptStore, 'get' | 'getMany' | 'giveUpIfAwaitingRetry'>;
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
  if (input.length > MAX_URL_LENGTH) return undefined;
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

  const registered = await deps.registered.add(url, createdBy, now);
  return registered ? { kind: 'registered', registered } : { kind: 'already-registered' };
}

/** @returns `false` when there was no such registration */
export async function unregisterUrl(deps: RegisteredUrlDeps, id: string): Promise<boolean> {
  const entry = await deps.registered.get(id);
  if (!entry) return false;

  // A URL waiting for a retry would otherwise keep being tried after the registration is gone.
  // Both sides are transactions: this never overwrites a result a run stored in the meantime,
  // and a run cannot put the given-up URL back in the queue (`AttemptStore.save`)
  await deps.attempts.giveUpIfAwaitingRetry(entry.url, UNREGISTERED_REASON);
  await deps.registered.remove(id);
  return true;
}
