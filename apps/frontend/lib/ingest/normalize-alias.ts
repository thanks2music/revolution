/**
 * 名寄せ照合キーの正規化 (naming doc §4-4 の 5 段)
 *
 * `title_aliases.alias` / `venue_aliases.alias` は **正規化済みの文字列を PK として
 * 格納する** 設計 (`one-more-time/docs/schema/revolution-naming-yaml.md` §3)。
 * 「入力を正規化 → PK 直接一致」で引けることが名寄せの前提なので、
 * **同じ関数を seed 時 (格納前) と照合時 (入力) の両方に適用する**。
 * 片方だけに適用すると一致しない。
 *
 * 5 段の処理 (順序も規約の一部):
 * 1. NFKC 正規化 — 全角英数・互換文字を統一 (`ＫＩＴＴＥ` → `KITTE`、`１` → `1`)。
 *    全角括弧・全角スペースも ASCII 側へ寄る
 * 2. 括弧内を除去 — `(スマイルベースカフェ)` `(旧: GraffArt CAFE)` 等の補足を落とす
 * 3. `&` → `and` — `BOX CAFE & SPACE` と `BOX cafe&space` を同一視
 * 4. 空白を全除去 — `スイーツパラダイス 池袋店` と `スイーツパラダイス池袋店` を同一視
 * 5. 小文字化 — `BOX CAFE` と `BOX cafe` を同一視
 */
export function normalizeAlias(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\([^()]*\)/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, '')
    .toLowerCase();
}
