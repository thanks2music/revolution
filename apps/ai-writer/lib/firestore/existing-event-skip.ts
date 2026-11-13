/**
 * Decide whether an article run must stop because the event already has an article.
 *
 * A record in `event_canonical_keys` with status `generated` means an article PR was
 * created for this event. The pipeline now skips such events **whatever state the PR
 * is in** (open, merged or closed without merging).
 *
 * Before this, the pipeline regenerated the article whenever no PR was open. GitHub's
 * `is:closed` search also matches merged PRs, so a merged article was deleted from
 * Firestore and written again. A scheduled run would then open a new PR for the same
 * event every time.
 *
 * Follow-up announcements are applied by a person with `--update`. To write an event
 * again from scratch, reset its record first (the reset button on the RSS → MDX debug
 * page, which calls `POST /api/debug/reset-firestore-status`).
 */
import type { DuplicationCheckResult } from './types';

/** The event that stopped the run, for the caller's message and reset button */
export interface ExistingEvent {
  canonicalKey: string;
  postId?: string;
}

/**
 * @returns the existing event and the skip reason when the event already has an article,
 *   otherwise `undefined`
 */
export function existingEventSkip(
  check: DuplicationCheckResult
): { event: ExistingEvent; reason: string } | undefined {
  // `isDuplicate` alone decides. Going on without the document would make
  // registerNewEvent throw "already exists", which is reported as a failure.
  if (!check.isDuplicate) {
    return undefined;
  }

  const postId = check.existingDoc?.postId;
  const reason =
    `既に記事があるイベントのためスキップ (canonicalKey: ${check.canonicalKey}` +
    `${postId ? `、post_id: ${postId}` : ''})。続報は --update で更新する。` +
    `作り直す時は、デバッグ画面 (RSS → MDX) のリセットで記録を戻してから実行する`;

  return { event: { canonicalKey: check.canonicalKey, postId }, reason };
}
