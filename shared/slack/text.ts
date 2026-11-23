/**
 * Slack のメッセージに値を埋め込むための部品。
 *
 * 外部から来た値 (表示名・本文・URL・エラー文など) は、必ず切り詰めてからエスケープする。
 * エスケープの後で切ると、`&amp;` の途中で切れて表示が崩れるため。上限が Slack に届いた文字列で数えられる所
 * (Block Kit の section など) では、entity を割らずに切る {@link escapeAndTruncate} を使う。
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

/**
 * エスケープした後の長さが max 字以下になるように切る。Block Kit の section の text (3000 字) のように、
 * 上限が Slack に届いた文字列で数えられる所に使う。「切ってからエスケープ」だと、`&` が `&amp;` (5 字) に
 * 増えて上限を超え、メッセージごと拒まれる (`invalid_blocks`)。末尾で割れた entity (`&am` など) は落とす
 */
export function escapeAndTruncate(value: string, max: number): string {
  const escaped = escapeSlackText(value);
  if (Array.from(escaped).length <= max) return escaped;
  return truncate(escaped, max).replace(/&[a-z]{0,3}…$/, '…');
}
