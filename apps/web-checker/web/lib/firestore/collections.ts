/**
 * WEB チェッカーのコレクション名。Functions (`apps/web-checker/functions/src/targets.ts`) と rules と同じ名前にする。
 * AI ライターと同じ Firestore に置くので、名前に web_checker を付けている。
 */
export const TARGETS_COLLECTION = 'web_checker_targets';

/** 監視対象ごとの履歴。書けるのは Functions (Admin SDK) だけ */
export const SNAPSHOTS_SUBCOLLECTION = 'snapshots';
