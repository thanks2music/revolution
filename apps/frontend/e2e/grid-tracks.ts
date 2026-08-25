/**
 * `grid-template-columns` の computed 値から**列トラック数**を求める。
 *
 * Playwright に依存しない純粋関数 (プロジェクト規約の **Layer 1**) として切り出して
 * あるので、Jest から直接テストできる (`__tests__/unit/e2e/grid-tracks.test.ts`)。
 * Playwright 本体は staging の dev サーバを要求するため CI で動かせないが、
 * **この関数の分岐だけは CI で守れる**。
 *
 * ## computed 値の形が複数ある (実測 2026-08-25 / Chrome)
 *
 * Chrome の `getComputedStyle().gridTemplateColumns` は
 * **`repeat(2, minmax(0px, 1fr))` の形のまま返すことがある**。解決済みの
 * `"295px 295px 295px"` を前提に空白で分割すると `repeat(2,` / `minmax(0px,` /
 * `1fr))` の 3 要素になり、**3 列のグリッドが偶然一致して通ってしまう**
 * (初版の実装が実際にこれで空振りしていた)。
 *
 * ## 🔴 未知の形は「1 列」に丸めず**例外にする** (fail-closed)
 *
 * 空白の数で推測すると、回帰テストのオラクルとして誤った合格を出す:
 *
 * | 入力 | 空白分割 | 実際のトラック数 |
 * |---|---|---|
 * | `[start] 1fr` | 2 | **1** |
 * | `repeat(2, 1fr) 100px` | 2 | **3** |
 * | `repeat(auto-fill, minmax(0px, 1fr))` | 3 | 不定 |
 * | `repeat(2, 1fr) repeat(3, 1fr)` | 4 | **5** |
 *
 * どれも宣言列数と偶然一致しうる。**扱える形だけを扱い、それ以外は落とす。**
 * 落ちたら、その形を扱えるように本関数を拡張する (推測で通さない)。
 */

/** 単一の固定回数 `repeat(N, …)` だけ。`repeat(auto-fill, …)` は N が数値でないため一致しない。 */
const FIXED_REPEAT = /^repeat\((\d+),.*\)$/;

/**
 * `repeat()` が 2 つ以上連結されていないか。
 *
 * `FIXED_REPEAT` の `.*` は greedy なので、`repeat(2, 1fr) repeat(3, 1fr)` は
 * **先頭の 2 だけを返してしまう** (正しくは 5)。fail-closed を掲げているのに
 * ここだけ静かに誤った値を返すのは契約の不整合なので明示的に弾く
 * (claude-review 指摘 2026-08-25)。
 *
 * ⚠️ **`.*` を `[^)]*` に締める修正は誤り。** Chrome が実際に返すのは
 *    `repeat(2, minmax(0px, 1fr))` で、内側の `minmax(…)` が `)` を含むため
 *    `[^)]*` では一致せず、**全グリッドが例外になる** (2026-08-25 実測)。
 */
const hasMultipleRepeats = (value: string): boolean => value.indexOf('repeat(', 1) !== -1;

/** 解決済みトラック一覧 (`"295.33px 295.33px"`)。行名や `fr` を含む形は意図的に除く。 */
const RESOLVED_PX_TRACKS = /^\d+(?:\.\d+)?px(?: \d+(?:\.\d+)?px)*$/;

export function countTracks(template: string): number {
  const value = template.trim();

  // 列指定なし = 分岐が当たっていない = 1 カラム。
  // クラス名を綴り間違えた場合もここに落ちるので、宣言との差分で検出できる。
  if (value === 'none') return 1;

  const fixedRepeat = FIXED_REPEAT.exec(value);
  if (fixedRepeat && !hasMultipleRepeats(value)) return Number(fixedRepeat[1]);

  if (RESOLVED_PX_TRACKS.test(value)) return value.split(' ').length;

  throw new Error(
    `未対応の grid-template-columns: ${JSON.stringify(value)}\n` +
      '空白の数で列数を推測すると誤った合格を出すため、意図的に失敗させています。' +
      'この形を扱う必要があるなら e2e/grid-tracks.ts を拡張してください。',
  );
}
