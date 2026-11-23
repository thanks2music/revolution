/**
 * 履歴 (`web_checker_targets/{id}/snapshots` のドキュメント) を画面で扱う形。
 *
 * 書くのは Functions (Admin SDK) だけで、画面は読むだけ。
 */
export interface Snapshot {
  /** Firestore の doc ID */
  id: string;
  /**
   * 抜き出した部分の HTML。外のページの生の HTML なので、必ず文字として表示する
   * (HTML として描画しない。eslint の react/no-danger で止めている)
   */
  content: string;
  /** 取得した日時 (ms の epoch) */
  time: number;
}
