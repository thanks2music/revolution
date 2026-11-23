/**
 * 監視対象 (`web_checker_targets` コレクションのドキュメント) を画面で扱う形。
 *
 * Firestore の形の正本は `apps/web-checker/functions/src/targets.ts` の `Target`。画面は読む時に欠けた値を
 * 既定値か null に倒すので (`lib/firestore/mappers.ts`)、こちらは任意のフィールドを null で持つ。
 * 足しているのは doc ID の `id` だけ。
 *
 * 日時はすべて ms の epoch (数値)。Functions が数値で比べるので、`serverTimestamp()` は使わない。
 */
export interface Target {
  /** Firestore の doc ID */
  id: string;
  /** 見に行く URL (https のみ) */
  url: string;
  /** ページから抜き出す部分の CSS セレクタ */
  selector: string;
  /** 通知と一覧に出す名前 */
  title: string;
  /** 見に行く頻度 (cron、Asia/Tokyo) */
  cron: string;
  /** 最後に見に行った日時。書くのは Functions だけで、画面は読むだけ */
  checkedAt: number | null;
  createdAt: number | null;
  /** 作った人の uid */
  createdBy: string | null;
  updatedAt: number | null;
  /** 最後に変えた人の uid */
  updatedBy: string | null;
}

/**
 * 画面が入力として書く値 (作成と更新で共通)。
 *
 * `checkedAt` は Functions だけが書くので含めない。`createdAt`・`createdBy`・`updatedAt`・`updatedBy` は
 * Service が付ける。rules が書いてよいキーを限っているので、ここに無いキーを足すと保存できなくなる。
 */
export type TargetInput = Pick<Target, 'url' | 'selector' | 'title' | 'cron'>;
