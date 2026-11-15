/**
 * Layer C: rules that span entries or files.
 *
 * The title rules run on the merged dictionary (`mergeTitleMappings`: the hand-written file wins on a shared key),
 * which is what the slug resolver looks up. When two works share a slug or an alias, the resolver silently picks
 * one or resolves to nothing, so an article can get the wrong work's URL without any error.
 */
import { TITLE_SLUG_REGEX } from '@revolution/schemas/title';
import { mergeTitleMappings } from '@/lib/config/yaml-loader';
import type { TitleRomajiMapping } from '@/lib/config/types';
import { DICTIONARY_SCHEMAS, configDocPath, formatPath } from './dictionaries';
import type { TemplateIssue } from './issues';
import type { TemplatesLayout } from './layout';
import type { ParsedDocs } from './syntax';

/** Returns the dictionary when it exists and matches its schema; otherwise null (its issues are reported by Layer B) */
function validDoc<T>(layout: TemplatesLayout, docs: ParsedDocs, file: string): T | null {
  const doc = docs.get(configDocPath(layout, file));
  if (doc === undefined) return null;
  return DICTIONARY_SCHEMAS[file].schema.safeParse(doc).success ? (doc as T) : null;
}

export function checkCrossFile(layout: TemplatesLayout, docs: ParsedDocs): TemplateIssue[] {
  return [...checkTitles(layout, docs), ...checkEventTypes(layout, docs), ...checkVenues(layout, docs), ...checkPrefectures(layout, docs)];
}

function checkTitles(layout: TemplatesLayout, docs: ParsedDocs): TemplateIssue[] {
  const hand = validDoc<TitleRomajiMapping>(layout, docs, 'title-romaji-mapping.yaml');
  if (!hand) return [];
  const generated = validDoc<TitleRomajiMapping>(layout, docs, 'title-romaji-mapping.generated.yaml');
  const merged = mergeTitleMappings(hand, generated).titles;
  const handFile = configDocPath(layout, 'title-romaji-mapping.yaml');
  const generatedFile = configDocPath(layout, 'title-romaji-mapping.generated.yaml');
  const fileOf = (title: string) => (title in hand.titles ? handFile : generatedFile);
  const issues: TemplateIssue[] = [];

  const titlesBySlug = new Map<string, string[]>();
  for (const [title, value] of Object.entries(merged)) {
    const slug = typeof value === 'string' ? value : value.slug;
    titlesBySlug.set(slug, [...(titlesBySlug.get(slug) ?? []), title]);
  }
  for (const [slug, titles] of titlesBySlug) {
    if (titles.length < 2) continue;
    issues.push({
      rule: 'title/slug-duplicate',
      file: fileOf(titles[0]),
      at: formatPath(['titles', titles[0]]),
      message: `slug "${slug}" is used by ${titles.length} works: ${titles.join(' / ')} (make the others aliases)`,
    });
  }

  // Every name a work is looked up by (its key and its aliases) must lead to one slug
  const slugsByName = new Map<string, Set<string>>();
  const ownersByName = new Map<string, string[]>();
  for (const [title, value] of Object.entries(merged)) {
    const slug = typeof value === 'string' ? value : value.slug;
    const names = [title, ...(typeof value === 'string' ? [] : (value.aliases ?? []))];
    for (const name of new Set(names)) {
      slugsByName.set(name, (slugsByName.get(name) ?? new Set()).add(slug));
      ownersByName.set(name, [...(ownersByName.get(name) ?? []), title]);
    }
  }
  for (const [name, slugs] of slugsByName) {
    if (slugs.size < 2) continue;
    const owners = ownersByName.get(name)!;
    issues.push({
      rule: 'title/alias-ambiguous',
      file: fileOf(owners[0]),
      at: formatPath(['titles', owners[0]]),
      message: `"${name}" points to ${slugs.size} slugs (${[...slugs].join(' / ')}) through ${owners.join(' / ')}`,
    });
  }

  // A slug-shaped alias (an old slug kept for redirects) that is another work's slug: the resolver keeps the slug
  // for that other work and drops the alias, so the old URL would lead to the wrong work
  for (const [title, value] of Object.entries(merged)) {
    if (typeof value === 'string') continue;
    for (const alias of value.aliases ?? []) {
      if (alias === value.slug || !TITLE_SLUG_REGEX.test(alias)) continue;
      const others = titlesBySlug.get(alias);
      if (!others) continue;
      issues.push({
        rule: 'title/alias-is-other-slug',
        file: fileOf(title),
        at: formatPath(['titles', title, 'aliases']),
        message: `alias "${alias}" is the slug of ${others.join(' / ')}`,
      });
    }
  }
  return issues;
}

function checkEventTypes(layout: TemplatesLayout, docs: ParsedDocs): TemplateIssue[] {
  const eventTypes = validDoc<{ event_types: Record<string, string>; heading_labels?: Record<string, string> }>(
    layout,
    docs,
    'event-type-slugs.yaml'
  );
  const registry = validDoc<{ categories: Array<{ slug: string }> }>(layout, docs, 'slug-registry.yaml');
  if (!eventTypes || !registry) return [];
  const file = configDocPath(layout, 'event-type-slugs.yaml');
  const categories = new Set(registry.categories.map((category) => category.slug));
  const issues: TemplateIssue[] = [];
  for (const [name, slug] of Object.entries(eventTypes.event_types)) {
    if (!categories.has(slug)) {
      issues.push({
        rule: 'event-type/unknown-category',
        file,
        at: formatPath(['event_types', name]),
        message: `"${slug}" is not a category in slug-registry.yaml`,
      });
    }
  }
  const eventTypeSlugs = new Set(Object.values(eventTypes.event_types));
  for (const slug of Object.keys(eventTypes.heading_labels ?? {})) {
    if (!eventTypeSlugs.has(slug)) {
      issues.push({
        rule: 'event-type/unknown-heading-label',
        file,
        at: formatPath(['heading_labels', slug]),
        message: `"${slug}" is not a slug in event_types`,
      });
    }
  }
  return issues;
}

function checkVenues(layout: TemplatesLayout, docs: ParsedDocs): TemplateIssue[] {
  const venues = validDoc<{ venues: Record<string, { slug: string; prefecture: string; aliases?: string[] }> }>(
    layout,
    docs,
    'venue-master.yaml'
  );
  const prefectures = validDoc<{ prefectures: Record<string, string> }>(layout, docs, 'jp-prefecture.yaml');
  if (!venues) return [];
  const file = configDocPath(layout, 'venue-master.yaml');
  const issues: TemplateIssue[] = [];
  const namesBySlug = new Map<string, string[]>();
  const slugsByLabel = new Map<string, Set<string>>();
  for (const [name, venue] of Object.entries(venues.venues)) {
    namesBySlug.set(venue.slug, [...(namesBySlug.get(venue.slug) ?? []), name]);
    // A venue label in an article is matched against the names and aliases
    for (const label of new Set([name, ...(venue.aliases ?? [])])) {
      slugsByLabel.set(label, (slugsByLabel.get(label) ?? new Set()).add(venue.slug));
    }
    if (prefectures && !(venue.prefecture in prefectures.prefectures)) {
      issues.push({
        rule: 'venue/unknown-prefecture',
        file,
        at: formatPath(['venues', name, 'prefecture']),
        message: `"${venue.prefecture}" is not a prefecture in jp-prefecture.yaml`,
      });
    }
  }
  for (const [slug, names] of namesBySlug) {
    if (names.length < 2) continue;
    issues.push({
      rule: 'venue/slug-duplicate',
      file,
      at: formatPath(['venues', names[0]]),
      message: `slug "${slug}" is used by ${names.length} venues: ${names.join(' / ')}`,
    });
  }
  for (const [label, slugs] of slugsByLabel) {
    if (slugs.size < 2) continue;
    issues.push({
      rule: 'venue/alias-ambiguous',
      file,
      message: `"${label}" names ${slugs.size} venues (${[...slugs].join(' / ')})`,
    });
  }
  return issues;
}

function checkPrefectures(layout: TemplatesLayout, docs: ParsedDocs): TemplateIssue[] {
  const config = validDoc<{ prefectures: Record<string, string>; regions?: Record<string, { prefectures: string[] }> }>(
    layout,
    docs,
    'jp-prefecture.yaml'
  );
  if (!config?.regions) return [];
  const file = configDocPath(layout, 'jp-prefecture.yaml');
  const slugs = new Set(Object.values(config.prefectures));
  const issues: TemplateIssue[] = [];
  for (const [region, { prefectures }] of Object.entries(config.regions)) {
    for (const slug of prefectures) {
      if (slugs.has(slug)) continue;
      issues.push({
        rule: 'prefecture/unknown-region-member',
        file,
        at: formatPath(['regions', region, 'prefectures']),
        message: `"${slug}" is not a prefecture slug in prefectures`,
      });
    }
  }
  return issues;
}
