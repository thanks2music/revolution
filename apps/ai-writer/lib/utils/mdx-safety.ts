/**
 * @fileoverview MDX として安全な形へ整える (Layer 1: 純粋関数)
 *
 * @description
 * LLM が生成する本文は HTML の書き方に揺れがある。MDX は JSX として評価するため、
 * HTML では許される書き方でも **ビルドが落ちる**。
 *
 * ## 実例 (2026-08-16、pochacco の再生成)
 *
 * ```
 * …涼しげなメニューが登場します。<br>
 * ```
 *
 * ```
 * Error occurred prerendering page "/articles/01m02zkq4xb26jge"
 * [next-mdx-remote] error compiling MDX:
 * Expected a closing tag for `<br>` (11:64-11:68) before the end of `paragraph`
 * ```
 *
 * 同じ企画の 1 世代前の記事には `<br>` が無く、**LLM 出力の揺れで発生する**。
 * プロンプトで禁じるだけでは再発を防げないため、決定論的に正規化する
 * (未置換プレースホルダーで得たのと同じ教訓)。
 */

/**
 * HTML の void 要素。終了タグを持たないため、JSX では自己閉じが必須。
 * @see https://html.spec.whatwg.org/multipage/syntax.html#void-elements
 */
const VOID_ELEMENTS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
] as const;

/** `<br>` `<img src="...">` のような、自己閉じでない void 要素にマッチする。 */
const VOID_TAG_PATTERN = new RegExp(`<(${VOID_ELEMENTS.join('|')})(\\s[^<>]*?)?\\s*>`, 'gi');

/** コードフェンスで分割する (フェンス自体も配列に残す)。 */
function splitByCodeFence(mdx: string): string[] {
  return mdx.split(/(```[\s\S]*?```)/);
}

/**
 * void 要素を自己閉じ形へ正規化する。
 *
 * コードフェンス内 (`\`\`\` … \`\`\``) とインラインコード (`` \`…\` ``) は、
 * HTML の書き方を説明している可能性があるため対象外にする。
 * 既に `<br />` の形になっているものは変更しない。
 *
 * @param mdx - LLM が生成した MDX 本文
 * @returns void 要素を自己閉じにした MDX
 *
 * @example
 * selfCloseVoidElements('登場します。<br>')        // → '登場します。<br />'
 * selfCloseVoidElements('<img src="a.png">')       // → '<img src="a.png" />'
 * selfCloseVoidElements('既に<br />です')          // → 変更なし
 */
export function selfCloseVoidElements(mdx: string): string {
  return splitByCodeFence(mdx)
    .map((segment) => {
      if (segment.startsWith('```')) return segment; // コードブロックは触らない

      return segment
        .split(/(`[^`\n]*`)/)
        .map((part) => {
          if (part.startsWith('`')) return part; // インラインコードは触らない

          return part.replace(VOID_TAG_PATTERN, (match, tag: string, attrs?: string) => {
            if (match.endsWith('/>')) return match; // 既に自己閉じ
            const attrPart = attrs ? ` ${attrs.trim()}` : '';
            return `<${tag}${attrPart} />`;
          });
        })
        .join('');
    })
    .join('');
}

/**
 * 自己閉じでない void 要素を列挙する (検査用)。
 *
 * @returns 見つかったタグ文字列 (重複除去)。無ければ空配列
 */
export function findUnclosedVoidElements(mdx: string): string[] {
  const found: string[] = [];

  for (const segment of splitByCodeFence(mdx)) {
    if (segment.startsWith('```')) continue;

    for (const part of segment.split(/(`[^`\n]*`)/)) {
      if (part.startsWith('`')) continue;
      found.push(...(part.match(VOID_TAG_PATTERN) ?? []).filter((m) => !m.endsWith('/>')));
    }
  }

  return [...new Set(found)];
}
