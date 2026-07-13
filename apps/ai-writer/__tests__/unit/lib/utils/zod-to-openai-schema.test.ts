/**
 * Layer 1 unit tests for zodToOpenAiSchema — pure Zod → OpenAI Structured Outputs
 * (strict mode) JSON Schema conversion helper.
 */

import { z } from 'zod';
import { zodToOpenAiSchema } from '@/lib/utils/zod-to-openai-schema';

describe('zodToOpenAiSchema', () => {
  it('returns { name, schema } tuple with the provided name', () => {
    const schema = z.object({ id: z.string() });
    const result = zodToOpenAiSchema(schema, 'MySchema');
    expect(result.name).toBe('MySchema');
    expect(result.schema).toBeDefined();
    expect((result.schema as { type: string }).type).toBe('object');
  });

  it('adds additionalProperties: false to every object node', () => {
    const schema = z.object({
      outer: z.object({
        inner: z.object({ deep: z.string() }),
      }),
    });
    const { schema: json } = zodToOpenAiSchema(schema, 'Nested');

    const root = json as {
      additionalProperties: boolean;
      properties: {
        outer: {
          additionalProperties: boolean;
          properties: { inner: { additionalProperties: boolean } };
        };
      };
    };
    expect(root.additionalProperties).toBe(false);
    expect(root.properties.outer.additionalProperties).toBe(false);
    expect(root.properties.outer.properties.inner.additionalProperties).toBe(false);
  });

  it('marks every property as required (strict mode requirement)', () => {
    const schema = z.object({
      a: z.string(),
      b: z.number(),
      c: z.boolean(),
    });
    const { schema: json } = zodToOpenAiSchema(schema, 'X');
    const root = json as { required: string[] };
    expect(root.required.sort()).toEqual(['a', 'b', 'c']);
  });

  it('preserves nullable via type union rather than optional (strict mode fields must be required)', () => {
    const schema = z.object({
      maybe_name: z.string().nullable(),
    });
    const { schema: json } = zodToOpenAiSchema(schema, 'X');
    const root = json as {
      required: string[];
      properties: { maybe_name: { type?: string | string[]; anyOf?: unknown[] } };
    };
    // property must appear in required
    expect(root.required).toContain('maybe_name');
    // and its type must allow null (either via type: ["string", "null"] or anyOf)
    const prop = root.properties.maybe_name;
    const typeAllowsNull =
      (Array.isArray(prop.type) && prop.type.includes('null')) ||
      (Array.isArray(prop.anyOf) &&
        prop.anyOf.some((s) => (s as { type?: string }).type === 'null'));
    expect(typeAllowsNull).toBe(true);
  });

  it('strips unsupported keywords like format / minLength / minItems', () => {
    const schema = z.object({
      email: z.string().email().min(3).max(255),
      items: z.array(z.string()).min(1).max(10),
      count: z.number().min(0).max(100),
    });
    const { schema: json } = zodToOpenAiSchema(schema, 'X');
    const stringified = JSON.stringify(json);
    // These keywords cause OpenAI strict-mode API errors and must be scrubbed.
    expect(stringified).not.toContain('"format"');
    expect(stringified).not.toContain('"minLength"');
    expect(stringified).not.toContain('"maxLength"');
    expect(stringified).not.toContain('"minItems"');
    expect(stringified).not.toContain('"maxItems"');
    expect(stringified).not.toContain('"minimum"');
    expect(stringified).not.toContain('"maximum"');
    expect(stringified).not.toContain('"pattern"');
  });

  it('handles array of objects (used by event_data.occurrences[])', () => {
    const schema = z.object({
      occurrences: z.array(
        z.object({
          starts_on: z.string(),
          venue_label: z.string().nullable(),
        })
      ),
    });
    const { schema: json } = zodToOpenAiSchema(schema, 'X');
    const root = json as {
      properties: {
        occurrences: { type: string; items: { additionalProperties: boolean; required: string[] } };
      };
    };
    expect(root.properties.occurrences.type).toBe('array');
    expect(root.properties.occurrences.items.additionalProperties).toBe(false);
    expect(root.properties.occurrences.items.required.sort()).toEqual([
      'starts_on',
      'venue_label',
    ]);
  });

  it('throws fail-loud when input schema declares a property as .optional() (strict mode requires .nullable())', () => {
    // OpenAI strict mode requires every property to be in `required`. Silently promoting
    // `.optional()` fields would paper over a schema authoring mistake (author probably meant
    // `.nullable()` to express "may be absent"). Fail loud so drift is caught at conversion time.
    const badSchema = z.object({
      required_field: z.string(),
      optional_field: z.string().optional(),
    });
    expect(() => zodToOpenAiSchema(badSchema, 'BadSchema')).toThrow(
      /use `\.nullable\(\)` instead of `\.optional\(\)`/
    );
  });

  it('handles enum-typed fields (used by primary_category_slug)', () => {
    const schema = z.object({
      slug: z.enum(['collabo-cafe', 'pop-up-store', 'other-collabo']),
    });
    const { schema: json } = zodToOpenAiSchema(schema, 'X');
    const root = json as { properties: { slug: { enum: string[] } } };
    expect(root.properties.slug.enum).toEqual([
      'collabo-cafe',
      'pop-up-store',
      'other-collabo',
    ]);
  });
});

describe('zodToOpenAiSchema — ExtractionResponseSchema shape assertion (OpenAI strict-mode round-trip guard)', () => {
  /**
   * Zod schema の変更で unsupported keyword が strict-mode API に混入するのを防ぐ回帰テスト。
   * ExtractionResponseSchema を実際に変換し、OpenAI が拒否する keyword 群
   * (format / pattern / minLength / maxLength / minimum / maximum / minItems / maxItems /
   * exclusiveMinimum / exclusiveMaximum / uniqueItems / default / multipleOf / $schema) が
   * 出力に残っていないこと + strict mode の必須制約 (全 object に additionalProperties: false +
   * properties が required に全登録) を assert する。
   */
  it('produces a strict-mode-compatible schema for ExtractionResponseSchema (no unsupported keywords, all objects additionalProperties:false + required)', async () => {
    const { ExtractionResponseSchema } = await import(
      '@revolution/schemas/extraction-response'
    );
    const { schema } = zodToOpenAiSchema(ExtractionResponseSchema, 'ExtractionResponse');
    const stringified = JSON.stringify(schema);

    const disallowed = [
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
    ];
    for (const keyword of disallowed) {
      expect(stringified).not.toContain(`"${keyword}"`);
    }

    // Recursively assert every object node has additionalProperties:false + required covers all properties.
    const walkAssert = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walkAssert);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
        expect(obj.additionalProperties).toBe(false);
        expect(Array.isArray(obj.required)).toBe(true);
        expect((obj.required as string[]).sort()).toEqual(
          Object.keys(obj.properties as Record<string, unknown>).sort()
        );
      }
      Object.values(obj).forEach(walkAssert);
    };
    walkAssert(schema);
  });
});
