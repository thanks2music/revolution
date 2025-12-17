/**
 * Store Name Validator Utility
 *
 * 店舗名として不適切な値（企業名、著作権表記等）を検出し、
 * フォールバック処理を促すための防御的バリデーション
 *
 * @module lib/utils/store-name-validator
 * @see templates/collabo-cafe/pipeline/2-extraction.yaml
 */

/**
 * 店舗名として不適切なパターン
 *
 * @description
 * YAML テンプレート（2-extraction.yaml）で除外ルールを定義しているが、
 * AIが100%従うとは限らないため、アプリ側でも防御的にチェックする。
 *
 * マッチした場合は null を返し、フォールバック処理（Step 1 の RSS 抽出結果）に任せる。
 */
const INVALID_STORE_NAME_PATTERNS: RegExp[] = [
  // 英語の法人格
  /CO\.,?\s*LTD\.?/i,
  /INC\.?$/i,
  /Corp\.?$/i,
  /Corporation$/i,
  /LLC$/i,

  // 日本語の法人格
  /株式会社/,
  /有限会社/,
  /合同会社/,

  // 製作委員会
  /製作委員会/,

  // コピーライト記号を含む（著作権表記）
  /©/,
  /\(C\)/i,
];

/**
 * 店舗名の妥当性を検証する
 *
 * @description
 * AI が抽出した店舗名が、実際には企業名や著作権表記である場合を検出し、
 * null を返すことでフォールバック処理を促す。
 *
 * これは「多層防御」の一環であり、YAML テンプレート側の除外ルールと
 * 組み合わせて使用することで、誤抽出のリスクを最小化する。
 *
 * @param name - AI が抽出した店舗名
 * @returns 妥当な店舗名の場合はそのまま返す。不適切な場合は null を返す。
 *
 * @example
 * ```typescript
 * // 正常なケース
 * validateStoreName('アニメイトカフェ池袋店')
 * // => 'アニメイトカフェ池袋店'
 *
 * // 不適切なケース（企業名）
 * validateStoreName('SANRIO CO., LTD.')
 * // => null (console.warn でログ出力)
 *
 * // null 入力
 * validateStoreName(null)
 * // => null
 * ```
 */
export function validateStoreName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }

  for (const pattern of INVALID_STORE_NAME_PATTERNS) {
    if (pattern.test(name)) {
      console.warn(
        `[store-name-validator] Invalid store name detected and rejected: "${name}" (matched: ${pattern})`
      );
      return null;
    }
  }

  return name;
}
