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
 * again from scratch, delete its record first.
 */
import type { DuplicationCheckResult } from './types';

/**
 * @returns the skip reason when the event already has an article, otherwise `undefined`
 */
export function existingEventSkipReason(check: DuplicationCheckResult): string | undefined {
  if (!check.isDuplicate || !check.existingDoc) {
    return undefined;
  }

  return (
    `既に記事があるイベントのためスキップ (canonicalKey: ${check.canonicalKey}、` +
    `post_id: ${check.existingDoc.postId})。続報は --update で更新する。` +
    `作り直す時は Firestore の記録を消してから実行する`
  );
}
