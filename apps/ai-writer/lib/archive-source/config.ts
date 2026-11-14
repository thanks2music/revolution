/**
 * Settings for archive sources: sites that hold past event articles which link to each event's
 * official site. When `pnpm debug:mdx <URL>` gets an article URL from one of them, the CLI builds
 * the article from the official site, or from the archive article when the official site is gone.
 *
 * The settings live in the private templates repository (`templates/config/archive-sources.yaml`,
 * copied by `pnpm sync:templates`). Without the file the feature is off.
 *
 * @module lib/archive-source/config
 */
import { existsSync, readFileSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';

import { ARCHIVE_SOURCES_PATH } from '@/lib/config/types';

const archiveSourceSchema = z.object({
  id: z.string().min(1),
  hosts: z.array(z.string().min(1)).min(1),
  /** WordPress REST collection URL; an article is looked up with `?slug=` */
  api_base: z.url(),
  /** Category ID → event type slug. The first ID of the article found here wins */
  categories: z.record(z.string(), z.string().min(1)),
  /** Names of the fields in the REST response that hold the category IDs and the event dates */
  fields: z.object({
    categories: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
  }),
  official_url: z.object({
    /** Summary table rows whose header equals one of these labels, in this order of preference */
    table_row_labels: z.array(z.string().min(1)).default([]),
    /** Link selector tried when no table row has a usable link */
    fallback_selector: z.string().min(1).optional(),
    /** Hosts (suffix match) that are never the official site: social, shops, affiliates */
    exclude_hosts: z.array(z.string().min(1)).default([]),
    /** Links carrying any of these query parameters are ads */
    exclude_query_params: z.array(z.string().min(1)).default([]),
  }),
  /** Elements removed from the archive article before it is used as the source */
  noise_selectors: z.array(z.string().min(1)).default([]),
  images: z.object({
    /** URL path prefixes of the archive's own images */
    path_prefixes: z.array(z.string().min(1)).min(1),
    exclude_name_contains: z.array(z.string().min(1)).default([]),
    /** Words in an `<h2>` that put the images up to the next `<h2>` into a category */
    section_keywords: z.object({
      menu: z.array(z.string().min(1)).default([]),
      novelty: z.array(z.string().min(1)).default([]),
      goods: z.array(z.string().min(1)).default([]),
    }),
    /** Event type slug → category for the images when no `<h2>` has a keyword */
    default_category_by_event_type: z.record(z.string(), z.enum(['menu', 'novelty', 'goods'])).default({}),
  }),
});

const archiveSourcesFileSchema = z.object({
  sources: z.array(archiveSourceSchema).default([]),
});

export type ArchiveSource = z.infer<typeof archiveSourceSchema>;

/** Parses the settings file. Throws when the file is malformed (a broken file must not silently turn the feature off) */
export function parseArchiveSources(yamlText: string): ArchiveSource[] {
  return archiveSourcesFileSchema.parse(yamlLoad(yamlText) ?? {}).sources;
}

/** Reads the settings, or returns an empty list when the file is absent */
export function loadArchiveSources(path: string = ARCHIVE_SOURCES_PATH): ArchiveSource[] {
  if (!existsSync(path)) return [];
  try {
    return parseArchiveSources(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load archive sources from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The archive source whose host matches the URL, if any */
export function findArchiveSource(url: string, sources: readonly ArchiveSource[]): ArchiveSource | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return sources.find((source) => source.hosts.some((candidate) => candidate.toLowerCase() === host));
}
