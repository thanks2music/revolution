/**
 * Layer B: the shape of each dictionary in `config/`.
 *
 * The schemas follow the types the code casts the YAML to (`lib/config/types.ts` and the loaders) and the
 * shared truth sources (`@revolution/schemas/title`). Unknown keys are allowed on purpose: Templates adds a
 * key before the code starts requiring it (see the templates CLAUDE.md for the order of changes).
 */
import * as path from 'path';
import { z } from 'zod';
import { TITLE_KIND_VALUES, TITLE_SLUG_REGEX } from '@revolution/schemas/title';
import type { TemplateIssue } from './issues';
import type { TemplatesLayout } from './layout';
import type { ParsedDocs } from './syntax';

export const SlugSchema = z.string().regex(TITLE_SLUG_REGEX, 'must be a slug (lowercase letters, digits and single hyphens)');
const NonEmpty = z.string().min(1);

export const TitleEntrySchema = z.union([
  SlugSchema,
  z.object({
    slug: SlugSchema,
    kind: z.enum(TITLE_KIND_VALUES).optional(),
    english_title: NonEmpty.optional(),
    short_title: NonEmpty.optional(),
    aliases: z.array(NonEmpty).optional(),
    source_ids: z.array(NonEmpty).optional(),
  }),
]);

export const TitleMappingSchema = z.object({ titles: z.record(z.string(), TitleEntrySchema) });

const SlugMap = z.record(z.string(), SlugSchema);

export const DICTIONARY_SCHEMAS: Record<string, { schema: z.ZodType; required: boolean }> = {
  'title-romaji-mapping.yaml': { schema: TitleMappingSchema, required: true },
  'title-romaji-mapping.generated.yaml': { schema: TitleMappingSchema, required: false },
  'brand-slugs.yaml': { schema: z.object({ brand_slugs: SlugMap }), required: true },
  'event-type-slugs.yaml': {
    schema: z.object({ event_types: SlugMap, heading_labels: z.record(SlugSchema, NonEmpty).optional() }),
    required: true,
  },
  'jp-prefecture.yaml': {
    schema: z.object({
      prefectures: SlugMap,
      regions: z.record(z.string(), z.object({ slug: SlugSchema, prefectures: z.array(SlugSchema) })).optional(),
      major_cities: SlugMap.optional(),
    }),
    required: true,
  },
  'venue-master.yaml': {
    schema: z.object({
      venues: z.record(
        z.string(),
        z.object({
          slug: SlugSchema,
          prefecture: NonEmpty,
          city: NonEmpty.optional(),
          address: NonEmpty.optional(),
          aliases: z.array(NonEmpty).optional(),
        })
      ),
    }),
    required: false,
  },
  'slug-registry.yaml': {
    schema: z.object({
      categories: z.array(z.object({ slug: SlugSchema, name: NonEmpty, aliases: z.array(NonEmpty).optional() })),
    }),
    required: false,
  },
  'title-sheet-overrides.yaml': {
    schema: z.object({
      overrides: z.record(
        z.string(),
        z.object({
          slug: SlugSchema.optional(),
          skip: z.boolean().optional(),
          separate: z.boolean().optional(),
          same_as: NonEmpty.optional(),
        })
      ),
    }),
    required: false,
  },
  'taxonomy.yaml': {
    schema: z.object({ axes: z.record(z.string(), z.unknown()), category_rules: z.record(z.string(), z.unknown()) }),
    required: true,
  },
};

export function configDocPath(layout: TemplatesLayout, file: string): string {
  return path.relative(layout.root, path.join(layout.configDir, file));
}

export function checkDictionaries(layout: TemplatesLayout, docs: ParsedDocs, failedToParse: Set<string>): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  for (const [file, { schema, required }] of Object.entries(DICTIONARY_SCHEMAS)) {
    const rel = configDocPath(layout, file);
    if (failedToParse.has(rel)) continue; // already reported by the syntax layer
    const doc = docs.get(rel);
    if (doc === undefined) {
      if (required) issues.push({ rule: 'schema/missing-file', file: rel, message: 'the file the code reads does not exist' });
      continue;
    }
    issues.push(...schemaIssues(schema, doc, rel));
  }
  return issues;
}

export function schemaIssues(schema: z.ZodType, doc: unknown, file: string): TemplateIssue[] {
  const result = schema.safeParse(doc);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    rule: `schema/${path.basename(file).replace(/\.ya?ml$/, '')}`,
    file,
    at: formatPath(issue.path),
    message: issue.message,
  }));
}

export function formatPath(segments: ReadonlyArray<PropertyKey>): string {
  return segments
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      const key = String(segment);
      return /^[A-Za-z_][\w-]*$/.test(key) ? (index === 0 ? key : `.${key}`) : `[${JSON.stringify(key)}]`;
    })
    .join('');
}
