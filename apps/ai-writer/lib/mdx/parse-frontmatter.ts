/**
 * MDX frontmatter の簡易パーサー (generate-article-index.ts で使用)。
 *
 * 既存の 1 行 flat parser (数値・quoted 文字列・inline 配列) を保持しつつ、
 * `event_data:` の nested YAML ブロックのみ js-yaml で解析して伝搬する
 * (Sprint C-α、MVP §11、claude[bot] コメント #2 / #3 対応)。
 *
 * 他の nested キーが増えた場合は `NESTED_KEYS` に追加すること。
 * schema-sdd-phase-3 で `MdxFrontmatterSchema.safeParse` に全面置換する TODO は
 * Sprint Refactor-A で `article-generation-mdx.service.ts` の DI 化と同時整理予定。
 *
 * pure module として `lib/mdx/` 配下に配置することで、Layer 1 test から
 * script 本体 (top-level `main()` 実行副作用) を経由せずに import 可能。
 */
import yaml from 'js-yaml';
import type { MdxFrontmatter } from '@revolution/schemas/mdx-frontmatter';

const NESTED_KEYS = new Set(['event_data']);

export function parseFrontmatter(content: string): MdxFrontmatter | null {
  // frontmatter部分を抽出
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const yamlContent = match[1];
  const result: Record<string, unknown> = {};

  // 行ごとに解析 (nested block support 付き)
  const lines = yamlContent.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // nested block header: `<key>:` (value 空 or 無し) を検出
    const nestedHeader = line.match(/^(\w+):\s*$/);
    if (nestedHeader && NESTED_KEYS.has(nestedHeader[1])) {
      const key = nestedHeader[1];
      // 以降のインデント行を集約 (空行は許容、非インデント行で終了)
      const blockLines: string[] = [];
      i++;
      while (i < lines.length) {
        const bl = lines[i];
        if (bl.length === 0 || /^\s/.test(bl)) {
          blockLines.push(bl);
          i++;
        } else {
          break;
        }
      }
      try {
        const yamlText = `${key}:\n${blockLines.join('\n')}`;
        // js-yaml v4 の `load` は safe by default (custom types を構築しない、旧 `safeLoad` 挙動)。
        // 追加の型検証は generator 出力全体を Schema-SDD compliance test で
        // `ArticleIndexSchema.safeParse` (MdxFrontmatterSchema extend) が実施する。
        const parsed = yaml.load(yamlText) as Record<string, unknown> | null;
        if (parsed && parsed[key] !== undefined && parsed[key] !== null) {
          result[key] = parsed[key];
        }
      } catch {
        // parse 失敗時は当該 key を欠落扱いに (既存挙動と一致、silent skip)
      }
      continue;
    }

    // key: value 形式を解析 (既存 flat parser)
    const keyValueMatch = line.match(/^(\w+):\s*(.*)$/);
    if (!keyValueMatch) {
      i++;
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    let value: unknown = rawValue;

    // 配列形式 ["a", "b"] を解析
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      try {
        value = JSON.parse(rawValue.replace(/'/g, '"'));
      } catch {
        // JSON解析失敗時は文字列として保持
        value = rawValue;
      }
    }
    // 数値を解析
    else if (/^\d+$/.test(rawValue)) {
      value = parseInt(rawValue, 10);
    }
    // クォート付き文字列を解析
    else if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      value = rawValue.slice(1, -1);
    }

    result[key] = value;
    i++;
  }

  return result as unknown as MdxFrontmatter;
}
