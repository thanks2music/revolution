/**
 * WEB チェッカーの監視対象と、その履歴 (Firestore) の形。
 *
 * 用語: 監視対象 = 決まった頻度で見に行くウェブページの一部。更新検知 = 抜き出した部分が前回から変わったこと。
 * 日時はすべて ms の epoch (数値)。画面 (apps/web-checker/web) と rules (apps/ai-writer/firestore.rules) も
 * この形を前提にしているので、フィールドを変える時は 3 か所をそろえる。
 */

/** 監視対象のコレクション。AI ライターと同じ Firestore に置くので、名前に web_checker を付ける */
export const TARGETS_COLLECTION = 'web_checker_targets';

/** 監視対象ごとの履歴 (抜き出した HTML) のサブコレクション。書けるのは Functions (Admin SDK) だけ */
export const SNAPSHOTS_SUBCOLLECTION = 'snapshots';

export interface Target {
  /** 見に行く URL (https のみ) */
  url: string;
  /** ページから抜き出す部分の CSS セレクタ */
  selector: string;
  /** 通知に出す名前 */
  title: string;
  /** 見に行く頻度 (cron、Asia/Tokyo)。見回りは毎時 1 回なので、1 時間より細かくは効かない */
  cron: string;
  /** 最後に見に行った日時。書くのは Functions だけ */
  checkedAt?: number;
  createdAt: number;
  createdBy: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface Snapshot {
  /** 抜き出した部分の HTML */
  content: string;
  /** 取得した日時 */
  time: number;
}
