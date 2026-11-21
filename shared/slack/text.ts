/**
 * Slack のメッセージに値を埋め込むための部品。
 *
 * 外部から来た値 (表示名・本文・URL・エラー文など) は、必ず切り詰めてからエスケープする。
 * エスケープの後で切ると、`&amp;` の途中で切れて表示が崩れるため。
 *
 * @module @revolution/slack/text
 */

/** Slack の制御文字 (`&` `<` `>`) をエスケープする。`<!channel>` が混ざると全員に通知が飛ぶため */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * max 文字を超えたら末尾を `…` にして切り詰める。
 * コードポイント単位で数える (UTF-16 単位で切ると絵文字のサロゲートペアが割れて文字化けする)
 */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
}
