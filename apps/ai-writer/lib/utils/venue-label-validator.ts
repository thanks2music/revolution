/**
 * Venue Label Validator Utility
 *
 * @description
 * `occurrences[].venue_label` として抽出された文字列が、**実際に会場と呼べるもの**か
 * を判定する防御的バリデーション。
 *
 * `store-name-validator.ts` と同じ設計思想に立つ — YAML テンプレートで
 * ルールを定義していても **AI が 100% 従うとは限らない**ため、アプリ側でも
 * 防御的にチェックする。
 *
 * ## なぜ必要か (2026-08-09 実測)
 *
 * `conan-cafe.jp` の dry-run で、抽出された唯一の「会場」が **`ONLINE販売`** だった。
 * これは販売形態であって会場ではない。そのまま通すと本文の H2 が
 *
 * ```
 * ## 名探偵コナン × ONLINE販売のメニュー
 * ```
 *
 * になる。読者が最初に見る見出しであり、理想 doc §2 中心軸 (a)「事実の正確性」の違反。
 *
 * 同様に `jujutsukaisen-cafe.jp` では `東京` / `愛知` / `大阪` が会場として抽出されていた。
 * これは都道府県であって会場ではない。
 *
 * ## 何をするか / しないか
 *
 * - **する**: 見出し・代表会場名の導出から除外する (`store-derivation.ts` が使う)
 * - **しない**: `occurrences[]` から要素を削除すること。抽出できた事実は残し、
 *   DB 取り込み (S3) 側の判断に委ねる。**見出しに出さないこと**と
 *   **データとして持たないこと**は別の問題である
 *
 * ## 過剰に弾かないための線引き
 *
 * - `全国17箇所のイオンモール内スペース` は **弾かない**。会場名が個別列挙されない
 *   ケースはそのまま 1 要素として保存する、と BOSS が確定済み (2026-08-09)。
 *   よって「全国」で始まる文字列を前方一致で弾いてはならない
 * - `JR京都駅 西口改札前 特設会場` は **弾かない**。「特設」を含むが実在の会場である
 * - `コーチャンフォー新川通り店 カフェ インターリュード` は **弾かない**。
 *   ブランド辞書に無いだけで会場ではある
 *
 * @module lib/utils/venue-label-validator
 * @see lib/utils/store-name-validator.ts (同じ「防御的チェック」の先例)
 * @see lib/utils/store-derivation.ts (本モジュールの利用側)
 */

/**
 * それ単独では会場を指さない語 (完全一致で判定)。
 *
 * ★ 前方一致にしてはならない。`全国17箇所のイオンモール内スペース` のような
 *   「会場名が列挙されないが開催実体はある」ケースを巻き込む。
 */
const NON_VENUE_EXACT = new Set([
  '全国',
  '全国各地',
  '各地',
  '未定',
  '後日発表',
  '後日公開',
  'オンライン',
  'ONLINE',
  'online',
]);

/** 販売・受付チャネルであって会場ではないパターン。 */
/**
 * 地名の連結に使われる区切り。
 *
 * ★ 本 PR 自身が「N都市」の都市表記でこの文字を使う (`東京・大阪`) ため、
 *   同じ形の文字列が `venue_label` に入り込むことは十分ありうる。
 */
const CONCAT_SEPARATOR = '・';

const NON_VENUE_PATTERNS: RegExp[] = [
  // ONLINE販売 / ONLINE STORE / オンライン販売 / オンラインストア
  /^ONLINE\b/i,
  /^オンライン/,
  // 通販 / 通信販売 (末尾一致。「〜店 通販」のような複合は会場側が主語なので弾かない)
  /^(通販|通信販売)$/,
  // ○○販売 で終わる (ONLINE販売 / 先行販売 等)。会場名が「販売」で終わることはない
  /販売$/,
  // 公式ショップ / 公式オンラインストア / 特設サイト = Web 上の導線
  /^公式(オンライン)?(ショップ|ストア|サイト)/,
  /^特設サイト/,
  /^EC(サイト|ショップ)?$/i,
];

/**
 * 都道府県名の接尾辞を落とす。`道` は落とさない (北海道 → 北海 になるため)。
 *
 * ★ `store-derivation.ts` からも使う。同じ関数が 2 箇所にあると、
 *   一方だけ直して挙動が割れる (claude[bot] 指摘 2026-08-09)。
 */
export function shortenPrefecture(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '北海道') return trimmed;
  return trimmed.replace(/[都府県]$/, '');
}

/**
 * 会場名として不適切な場合に理由を返す。適切なら `null`。
 *
 * 純粋関数。throw しない (observability 規約)。
 *
 * @param label 判定対象の `venue_label`
 * @param prefectures 抽出された `開催都道府県`。**会場名がこれと同じなら会場ではない**
 *   (`東京` を会場として抽出してしまうケースの検出)
 *
 * @example
 * validateVenueLabel('ONLINE販売')                     // → '販売チャネルであって会場ではありません'
 * validateVenueLabel('東京', ['東京都', '大阪府'])       // → '都道府県名であって会場名ではありません'
 * validateVenueLabel('BOX cafe&space 東京ソラマチ店')    // → null
 * validateVenueLabel('全国17箇所のイオンモール内スペース')  // → null (会場名は無いが開催実体はある)
 */
export function validateVenueLabel(
  label: string,
  prefectures?: string[] | null
): string | null {
  const trimmed = label.replace(/^[\s　]+|[\s　]+$/g, '');
  if (trimmed.length === 0) return '空文字です';

  if (NON_VENUE_EXACT.has(trimmed)) {
    return `「${trimmed}」は場所の総称・販売チャネルであって会場ではありません`;
  }

  for (const pattern of NON_VENUE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `「${trimmed}」は販売・受付チャネルであって会場ではありません`;
    }
  }

  // 抽出された都道府県と同じ文字列は会場名ではない。
  // 「東京都」「東京」の双方に一致させるため接尾辞を落として比較する。
  for (const pref of prefectures ?? []) {
    const short = shortenPrefecture(pref);
    if (short.length === 0) continue;
    if (trimmed === short || trimmed === pref.trim()) {
      return `「${trimmed}」は都道府県名であって会場名ではありません`;
    }
  }

  // ★ 地名を「・」で連結した値も弾く (claude[bot] 指摘、2026-08-09)。
  //
  //   単一の都道府県との完全一致しか見ていなかったため、`東京・愛知・大阪` のような
  //   **連結**が素通りしていた。1 会場として扱われて Step 2 に落ち、
  //   `## 呪術廻戦 × 東京・愛知・大阪のメニュー` という見出しになる。
  //   これは本 PR が根絶した「地名の羅列が見出しに漏れる」バグと**同じ形**で、
  //   区切りが「、」ではなく「・」なだけである。
  //
  //   `occurrence-normalizer` は「・」で分割しない (「ルミネエスト新宿 1号店・2号店」
  //   のように会場名の内部に出るため)。分割しない判断は正しいので、
  //   **こちら側で「全要素が都道府県なら会場ではない」と判定する**。
  //
  //   ★ 一部だけ都道府県のケース (「東京・BOX cafe&space」) は弾かない。
  //     会場名が含まれる以上、除外すると情報を失う。全要素が地名のときだけ弾く。
  if (trimmed.includes(CONCAT_SEPARATOR)) {
    const parts = trimmed.split(CONCAT_SEPARATOR).map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length >= 2) {
      const knownCities = new Set<string>();
      for (const pref of prefectures ?? []) {
        const short = shortenPrefecture(pref);
        if (short.length > 0) {
          knownCities.add(short);
          knownCities.add(pref.trim());
        }
      }
      const allCities = parts.every((p) => knownCities.has(p));
      if (allCities) {
        return `「${trimmed}」は都道府県名を「${CONCAT_SEPARATOR}」で連結した値であって会場名ではありません`;
      }
    }
  }

  return null;
}
