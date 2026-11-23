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

/**
 * 検知リンク = 更新検知で新しく現れたリンクのうち、AI ライターに渡したもの。書くのは Functions だけで、
 * 読むのは AI ライターの定期実行 (Admin SDK)。ドキュメント ID は正規化した URL の SHA-256
 * (`@revolution/net/attempt-url`) で、AI ライターの「試した URL」・登録 URL と同じ ID になる
 */
export const DETECTED_LINKS_COLLECTION = 'web_checker_detected_links';

/**
 * 通知の仕方。`slack` = Slack に通知するだけ (既定)、`ai-writer` = AI ライターに渡して Slack にも通知する。
 * 値が無い監視対象 (この欄より前に作った物) は `slack` として扱う
 */
export const NOTIFY_MODES = ['slack', 'ai-writer'] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

export interface Target {
  /** 見に行く URL (https のみ) */
  url: string;
  /** ページから抜き出す部分の CSS セレクタ */
  selector: string;
  /** 通知に出す名前 */
  title: string;
  /** 見に行く頻度 (cron、Asia/Tokyo)。見回りは毎時 1 回なので、1 時間より細かくは効かない */
  cron: string;
  /** 通知の仕方。無ければ `slack` */
  notifyMode?: NotifyMode;
  /** 最後に見に行った日時。書くのは Functions だけ */
  checkedAt?: number;
  /**
   * 取得の失敗・抜き出す部分が無いことを最後に Slack へ知らせた日時。書くのは Functions だけ。
   * 同じ問題を毎時知らせないために使い、取得がうまくいったら消す
   */
  alertedAt?: number;
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

export interface DetectedLink {
  /** 正規化した URL (`normalizeAttemptUrl`) */
  url: string;
  /** どの監視対象の更新検知で現れたか */
  targetId: string;
  targetTitle: string;
  /** 検知した日時 (AI ライターは、検知から 30 日を過ぎた物を候補から外す) */
  detectedAt: number;
}
