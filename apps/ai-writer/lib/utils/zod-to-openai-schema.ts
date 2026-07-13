/**
 * Zod schema → OpenAI Structured Outputs (strict mode) 対応 JSON Schema 変換 helper。
 *
 * OpenAI Chat Completions API の `response_format: { type: 'json_schema',
 * json_schema: { ..., strict: true } }` に渡すため、以下の strict-mode 制約を満たす JSON Schema
 * を生成する:
 * - 全 object に `additionalProperties: false` (Zod v4 `toJSONSchema` の default)
 * - 全 property を `required` 化 (Zod v4 は非 optional field をすべて required に含める)
 * - `format` / `pattern` / `minLength` / `maxLength` / `minimum` / `maximum` /
 *   `minItems` / `maxItems` などの unsupported keyword を再帰的に削除
 *
 * Zod v4 の native `z.toJSONSchema()` を使用する。外部 package `zod-to-json-schema@3.25.2` は
 * peerDependency で zod v4 を宣言しつつも v4 スキーマに対して空の `$schema` のみを返す既知の
 * 互換問題があるため採用しない。
 *
 * @see https://platform.openai.com/docs/guides/structured-outputs
 * @see https://zod.dev/json-schema (Zod v4 native toJSONSchema)
 */

import { z } from 'zod';

/**
 * OpenAI Structured Outputs strict mode 用 response_format payload。
 */
export interface OpenAiJsonSchemaPayload {
  name: string;
  schema: Record<string, unknown>;
}

/**
 * OpenAI strict mode 非互換 keyword の除去 + `additionalProperties: false` + 全 required 化の
 * 再度保証。Zod v4 native output はすでに strict-friendly だが、validation constraint 由来の
 * keyword (`format`, `pattern`, `minLength` 等) が残るため再帰スキャンで除去する。
 *
 * strict mode で許可される keyword (公式): type / properties / items / required /
 * additionalProperties / enum / anyOf / oneOf / description / $defs / $ref。
 */
function normalizeForOpenAiStrict(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(normalizeForOpenAiStrict);
  }
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }

  const obj = schema as Record<string, unknown>;
  const disallowed = new Set([
    'format',
    'pattern',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minItems',
    'maxItems',
    'uniqueItems',
    'default',
    'multipleOf',
    '$schema',
  ]);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (disallowed.has(key)) continue;
    out[key] = normalizeForOpenAiStrict(value);
  }

  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    const propertyKeys = Object.keys(out.properties as Record<string, unknown>);
    // Fail loud when the input schema declared some property as `.optional()` — Zod emits it
    // via a shorter `required` array (properties key missing). OpenAI strict mode requires all
    // properties to be listed in `required`; silently promoting `.optional()` fields would paper
    // over a schema authoring mistake, so we throw and force the author to switch to `.nullable()`.
    if (Array.isArray(out.required)) {
      const declared = new Set(out.required as string[]);
      const missing = propertyKeys.filter((k) => !declared.has(k));
      if (missing.length > 0) {
        throw new Error(
          `zod-to-openai-schema: property ${missing.map((k) => `"${k}"`).join(', ')} is not in the ` +
            `input schema's \`required\` list (likely declared as \`.optional()\`). ` +
            `OpenAI Structured Outputs strict mode requires all properties to be required — ` +
            `use \`.nullable()\` instead of \`.optional()\` to express "may be absent" semantics.`
        );
      }
    }
    out.additionalProperties = false;
    out.required = propertyKeys;
  }

  return out;
}

/**
 * Zod schema を OpenAI Structured Outputs strict mode 対応 JSON Schema に変換。
 *
 * @param zodSchema - 変換対象の Zod v4 schema (top-level object 想定、`.optional()` 不使用推奨)
 * @param name - OpenAI に渡す schema 識別子 (`response_format.json_schema.name`、英数 + `_` のみ)
 * @returns `{ name, schema }` タプル (`strict: true` は呼び出し側で付与)
 */
export function zodToOpenAiSchema(
  zodSchema: z.ZodType,
  name: string
): OpenAiJsonSchemaPayload {
  const raw = z.toJSONSchema(zodSchema, { target: 'draft-7' });
  const normalized = normalizeForOpenAiStrict(raw) as Record<string, unknown>;
  return { name, schema: normalized };
}
