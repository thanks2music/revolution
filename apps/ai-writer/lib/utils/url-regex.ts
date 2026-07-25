/**
 * 本文中の絶対 URL を検出する regex (markdown link / bare URL / frontmatter 値の quoted URL いずれもマッチ)。
 *
 * character class の除外文字:
 * - ASCII: whitespace / `"` / `'` / `` ` `` / `)` / `<` / `>` / `]`
 * - 全角句読点: `、`(読点) / `。`(句点) / `」`(右鉤括弧) / `』`(右二重鉤括弧) /
 *   `〕`(右亀甲括弧) / `〉`(右角括弧) / `》`(右二重角括弧) / `】`(右隅付き括弧)
 *
 * 全角句読点の除外は日本語 prose 中で `https://example.com/?utm_source=collabo_cafe_dot_com。` の
 * ような UTM 付き URL + 句読点隣接パターンで、句読点が URL match に含まれてしまい後段の
 * `stripUtmFromUrl` 経由で prose corruption (句読点消失) が起きる回帰を防ぐ (Sprint C-β P14
 * claude[bot] R2 review 対応)。テスト詳細は
 * `apps/ai-writer/__tests__/unit/lib/utils/url-regex.test.ts` を参照。
 *
 * util module として `lib/utils/` に配置する理由: `scripts/remove-utm-from-articles.ts` は
 * ESM script で `import.meta.url` + `fileURLToPath` を top-level で使うため Jest から import
 * すると `__filename`/`__dirname` 二重定義 SyntaxError になる。regex を pure const util として
 * 分離することで Layer 1 test 直接検証を可能にする (前 sprint の `findMdxFiles` 抽出と同 pattern)。
 */
export const URL_REGEX = /https?:\/\/[^\s"'`)<>\]、。」』〕〉》】]+/g;
