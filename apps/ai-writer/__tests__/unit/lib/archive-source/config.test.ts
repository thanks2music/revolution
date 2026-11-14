import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it } from '@jest/globals';

import { findArchiveSource, loadArchiveSources, parseArchiveSources } from '@/lib/archive-source/config';

import { SOURCE } from './fixtures';

const YAML = `
sources:
  - id: test
    hosts: [archive.example.com]
    api_base: https://archive.example.com/wp-json/wp/v2/posts
    categories:
      10: collabo-cafe
    fields: { categories: event_types, start: starts_at, end: ends_at }
    official_url:
      table_row_labels: [公式サイト]
    images:
      path_prefixes: [/wp-content/uploads/]
      section_keywords:
        menu: [メニュー]
`;

describe('parseArchiveSources', () => {
  it('reads a source and fills the defaults', () => {
    const [source] = parseArchiveSources(YAML);
    expect(source.categories).toEqual({ '10': 'collabo-cafe' });
    expect(source.official_url.exclude_hosts).toEqual([]);
    expect(source.noise_selectors).toEqual([]);
    expect(source.images.section_keywords.goods).toEqual([]);
  });

  it('throws on a malformed file instead of turning the feature off', () => {
    expect(() => parseArchiveSources('sources:\n  - id: broken\n')).toThrow();
  });
});

describe('loadArchiveSources', () => {
  it('returns no sources when the file is absent', () => {
    expect(loadArchiveSources(join(tmpdir(), 'no-such-dir', 'archive-sources.yaml'))).toEqual([]);
  });

  it('reads the file when present', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'archive-sources-')), 'archive-sources.yaml');
    writeFileSync(path, YAML);
    expect(loadArchiveSources(path).map((s) => s.id)).toEqual(['test']);
  });
});

describe('findArchiveSource', () => {
  it('matches the host exactly, ignoring case', () => {
    expect(findArchiveSource('https://Archive.Example.com/events/a/', [SOURCE])).toBe(SOURCE);
    expect(findArchiveSource('https://sub.archive.example.com/events/a/', [SOURCE])).toBeUndefined();
  });

  it('returns undefined for other sites and invalid URLs', () => {
    expect(findArchiveSource('https://official.example.com/', [SOURCE])).toBeUndefined();
    expect(findArchiveSource('not a url', [SOURCE])).toBeUndefined();
  });
});
