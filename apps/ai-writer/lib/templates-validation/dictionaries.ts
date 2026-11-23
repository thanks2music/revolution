/**
 * Layer B: the shape of each dictionary in `config/`.
 *
 * The schemas follow the types the code casts the YAML to (`lib/config/types.ts` and the loaders) and the
 * shared truth sources (`@revolution/schemas/title`). Unknown keys are allowed on purpose: Templates adds a
 * key before the code starts requiring it (see the templates CLAUDE.md for the order of changes).
 */
import * as path from 'path';
import { z } from 'zod';
import { CATEGORY_SLUG_REGEX } from '@revolution/schemas/category';
import { TITLE_KIND_VALUES, TITLE_SLUG_REGEX } from '@revolution/schemas/title';
import { VENUE_SLUG_REGEX } from '@revolution/schemas/venue';
import { CharacterOwnersSchema, WorkDescriptionsSchema } from '@/lib/services/lead-modifier-config';
import type { TemplateIssue } from './issues';
import type { TemplatesLayout } from './layout';
import type { ParsedDocs } from './syntax';

const SLUG_MESSAGE = 'must be a slug (lowercase letters, digits and single hyphens)';
const SlugSchema = z.string().regex(TITLE_SLUG_REGEX, SLUG_MESSAGE);
/** Event type (category) slugs follow the categories' own truth source */
const CategorySlugSchema = z.string().regex(CATEGORY_SLUG_REGEX, SLUG_MESSAGE);
/** Venue slugs follow the venues table's own truth source (the seed checks them with it) */
const VenueSlugSchema = z.string().regex(VENUE_SLUG_REGEX, SLUG_MESSAGE);
const NonEmpty = z.string().min(1);

const TitleEntrySchema = z.union([
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

const TitleMappingSchema = z.object({ titles: z.record(z.string(), TitleEntrySchema) });

const SlugMap = z.record(z.string(), SlugSchema);

export const DICTIONARY_SCHEMAS: Record<string, { schema: z.ZodType; required: boolean }> = {
  'title-romaji-mapping.yaml': { schema: TitleMappingSchema, required: true },
  'title-romaji-mapping.generated.yaml': { schema: TitleMappingSchema, required: false },
  'brand-slugs.yaml': { schema: z.object({ brand_slugs: SlugMap }), required: true },
  'event-type-slugs.yaml': {
    schema: z.object({
      event_types: z.record(z.string(), CategorySlugSchema),
      heading_labels: z.record(CategorySlugSchema, NonEmpty).optional(),
    }),
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
          slug: VenueSlugSchema,
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
      categories: z.array(z.object({ slug: CategorySlugSchema, name: NonEmpty, aliases: z.array(NonEmpty).optional() })),
    }),
    // the category truth source of Templates (shared/schemas/category.ts); the event-type check depends on it
    required: true,
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
  // the lead modifier (the words before the work title) reads both on every article
  'work-descriptions.yaml': { schema: WorkDescriptionsSchema, required: true },
  'character-owners.yaml': { schema: CharacterOwnersSchema, required: true },
  'taxonomy.yaml': {
    schema: z.object({ axes: z.record(z.string(), z.unknown()), category_rules: z.record(z.string(), z.unknown()) }),
    required: true,
  },
};

export function configDocPath(layout: TemplatesLayout, file: string): string {
  return path.relative(layout.root, path.join(layout.configDir, file));
}

/**
 * @returns the issues, and the dictionaries (by file name in `config/`) that matched their schemas — the input of
 *   the cross-file rules, which run only on valid dictionaries
 */
export function checkDictionaries(
  layout: TemplatesLayout,
  docs: ParsedDocs,
  failedToParse: ReadonlySet<string>
): { issues: TemplateIssue[]; valid: Map<string, unknown> } {
  const issues: TemplateIssue[] = [];
  const valid = new Map<string, unknown>();
  for (const [file, { schema, required }] of Object.entries(DICTIONARY_SCHEMAS)) {
    const rel = configDocPath(layout, file);
    if (failedToParse.has(rel)) continue; // already reported by the syntax layer
    const doc = docs.get(rel);
    if (doc === undefined) {
      if (required) issues.push({ rule: 'schema/missing-file', file: rel, message: 'the file the code reads does not exist' });
      continue;
    }
    const found = schemaIssues(schema, doc, rel);
    if (found.length === 0) valid.set(file, doc);
    issues.push(...found);
  }
  return { issues, valid };
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
