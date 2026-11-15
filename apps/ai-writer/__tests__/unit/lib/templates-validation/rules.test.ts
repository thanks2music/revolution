/**
 * Templates validator, layers A–C and the report (Layer 1: pure rules over parsed documents, plus the
 * file walk on a temporary directory).
 *
 * Fixtures are made-up works and venues; the real dictionaries are private and absent on CI.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkCrossFile } from '@/lib/templates-validation/cross-file';
import { checkDictionaries } from '@/lib/templates-validation/dictionaries';
import { formatIssues, type TemplateIssue } from '@/lib/templates-validation/issues';
import { resolveLayout, type TemplatesLayout } from '@/lib/templates-validation/layout';
import { parseAllYaml, type ParsedDocs } from '@/lib/templates-validation/syntax';

const layout: TemplatesLayout = {
  kind: 'source',
  root: '/t',
  configDir: '/t/ai-writer/config',
  templatesDir: '/t/ai-writer/posts/yaml',
  sectionsDir: '/t/ai-writer/posts/yaml/collabo-cafe/sections',
  sharedDir: '/t/ai-writer/posts/yaml/collabo-cafe/shared',
  scanRoot: '/t/ai-writer',
};

/** A valid set of the dictionaries the validator checks */
function validDocs(): Record<string, unknown> {
  return {
    'title-romaji-mapping.yaml': {
      titles: {
        作品A: { slug: 'work-a', kind: 'anime', aliases: ['作品A別名', 'sakuhin-a'] },
        作品B: 'work-b',
      },
    },
    'title-romaji-mapping.generated.yaml': {
      titles: {
        作品A: { slug: 'generated-a' }, // same key as the hand-written file: the hand-written entry wins
        作品C: { slug: 'work-c', source_ids: ['x1'] },
      },
    },
    'brand-slugs.yaml': { brand_slugs: { ブランドA: 'brand-a' } },
    'event-type-slugs.yaml': {
      event_types: { 種別A: 'type-a', 種別A別名: 'type-a' },
      heading_labels: { 'type-a': '種別' },
    },
    'jp-prefecture.yaml': {
      prefectures: { 県A: 'pref-a', 県B: 'pref-b' },
      regions: { 地方A: { slug: 'region-a', prefectures: ['pref-a', 'pref-b'] } },
    },
    'venue-master.yaml': { venues: { 会場A: { slug: 'venue-a', prefecture: '県A', city: '市A' } } },
    'slug-registry.yaml': { categories: [{ slug: 'type-a', name: '種別A' }] },
    'title-sheet-overrides.yaml': { overrides: { id1: { slug: 'work-b' }, id2: { skip: true }, id3: { same_as: '作品A' } } },
    'taxonomy.yaml': { axes: {}, category_rules: {} },
  };
}

function toDocs(files: Record<string, unknown>): ParsedDocs {
  return new Map(Object.entries(files).map(([file, doc]) => [`ai-writer/config/${file}`, doc]));
}

function rulesOf(issues: TemplateIssue[]): string[] {
  return issues.map((issue) => issue.rule).sort();
}

describe('checkDictionaries (layer B)', () => {
  it('passes the valid set', () => {
    expect(checkDictionaries(layout, toDocs(validDocs()), new Set())).toEqual([]);
  });

  it('rejects a slug with uppercase letters, with the YAML path', () => {
    const files = validDocs();
    files['venue-master.yaml'] = { venues: { 会場A: { slug: 'Venue-A', prefecture: '県A' } } };
    const issues = checkDictionaries(layout, toDocs(files), new Set());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'schema/venue-master', file: 'ai-writer/config/venue-master.yaml', at: 'venues["会場A"].slug' });
  });

  it('rejects a kind outside the allowed values', () => {
    const files = validDocs();
    files['title-romaji-mapping.yaml'] = { titles: { 作品A: { slug: 'work-a', kind: 'movie' } } };
    expect(rulesOf(checkDictionaries(layout, toDocs(files), new Set()))).toEqual(['schema/title-romaji-mapping']);
  });

  it('reports a missing required file, but not a missing optional one', () => {
    const files = validDocs();
    delete files['brand-slugs.yaml'];
    delete files['title-romaji-mapping.generated.yaml'];
    expect(checkDictionaries(layout, toDocs(files), new Set())).toEqual([
      expect.objectContaining({ rule: 'schema/missing-file', file: 'ai-writer/config/brand-slugs.yaml' }),
    ]);
  });

  it('skips a file the syntax layer already reported', () => {
    const files = validDocs();
    delete files['brand-slugs.yaml'];
    expect(checkDictionaries(layout, toDocs(files), new Set(['ai-writer/config/brand-slugs.yaml']))).toEqual([]);
  });

  it('allows keys the code does not know yet', () => {
    const files = validDocs();
    files['brand-slugs.yaml'] = { brand_slugs: { ブランドA: 'brand-a' }, future_key: { anything: 1 } };
    expect(checkDictionaries(layout, toDocs(files), new Set())).toEqual([]);
  });
});

describe('checkCrossFile (layer C)', () => {
  it('passes the valid set (a generated entry under a hand-written key is overridden, not a conflict)', () => {
    expect(checkCrossFile(layout, toDocs(validDocs()))).toEqual([]);
  });

  it('reports two works sharing a slug across the hand-written and generated files', () => {
    const files = validDocs();
    (files['title-romaji-mapping.generated.yaml'] as { titles: Record<string, unknown> }).titles['作品D'] = { slug: 'work-b' };
    const issues = checkCrossFile(layout, toDocs(files));
    expect(rulesOf(issues)).toEqual(['title/slug-duplicate']);
    expect(issues[0].message).toContain('作品B / 作品D');
  });

  it('reports an alias that leads to two slugs', () => {
    const files = validDocs();
    (files['title-romaji-mapping.yaml'] as { titles: Record<string, unknown> }).titles['作品E'] = {
      slug: 'work-e',
      aliases: ['作品A別名'],
    };
    const issues = checkCrossFile(layout, toDocs(files));
    expect(rulesOf(issues)).toEqual(['title/alias-ambiguous']);
    expect(issues[0].message).toContain('"作品A別名" points to 2 slugs');
  });

  it('reports an alias equal to another work name', () => {
    const files = validDocs();
    (files['title-romaji-mapping.yaml'] as { titles: Record<string, unknown> }).titles['作品E'] = { slug: 'work-e', aliases: ['作品B'] };
    expect(rulesOf(checkCrossFile(layout, toDocs(files)))).toEqual(['title/alias-ambiguous']);
  });

  it('reports an event type outside the registry and a heading label for an unknown slug', () => {
    const files = validDocs();
    files['event-type-slugs.yaml'] = { event_types: { 種別A: 'type-a', 種別Z: 'type-z' }, heading_labels: { 'type-y': 'Y' } };
    expect(rulesOf(checkCrossFile(layout, toDocs(files)))).toEqual(['event-type/unknown-category', 'event-type/unknown-heading-label']);
  });

  it('reports a venue with an unknown prefecture and two venues sharing a slug', () => {
    const files = validDocs();
    files['venue-master.yaml'] = {
      venues: { 会場A: { slug: 'venue-a', prefecture: '県Z' }, 会場B: { slug: 'venue-a', prefecture: '県B' } },
    };
    expect(rulesOf(checkCrossFile(layout, toDocs(files)))).toEqual(['venue/slug-duplicate', 'venue/unknown-prefecture']);
  });

  it('reports a region member that is not a prefecture slug', () => {
    const files = validDocs();
    files['jp-prefecture.yaml'] = { prefectures: { 県A: 'pref-a' }, regions: { 地方A: { slug: 'region-a', prefectures: ['pref-z'] } } };
    files['venue-master.yaml'] = { venues: {} };
    expect(rulesOf(checkCrossFile(layout, toDocs(files)))).toEqual(['prefecture/unknown-region-member']);
  });

  it('does not run on a dictionary that failed its schema (layer B reports it)', () => {
    const files = validDocs();
    files['title-romaji-mapping.yaml'] = { titles: { 作品A: { slug: 'BAD' }, 作品B: { slug: 'BAD' } } };
    expect(checkCrossFile(layout, toDocs(files))).toEqual([]);
  });
});

describe('parseAllYaml and resolveLayout (layer A, on a temporary directory)', () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  function writeTree(files: Record<string, string>): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-validation-'));
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
      fs.writeFileSync(path.join(tmp, file), content);
    }
    return tmp;
  }

  it('parses valid files and reports duplicate keys, broken syntax and empty files', () => {
    const root = writeTree({
      'ai-writer/config/ok.yaml': 'a: 1\n',
      'ai-writer/config/dup.yaml': 'a: 1\na: 2\n',
      'ai-writer/posts/yaml/collabo-cafe/shared/broken.yaml': 'a: [1\n',
      'ai-writer/posts/yaml/empty.yaml': '# comment only\n',
      'ai-writer/config/not-yaml.txt': 'a: [',
    });
    const { docs, issues } = parseAllYaml(path.join(root, 'ai-writer'), root);
    expect([...docs.keys()]).toEqual(['ai-writer/config/ok.yaml']);
    expect(issues.map((issue) => [issue.rule, issue.file])).toEqual([
      ['yaml/parse', 'ai-writer/config/dup.yaml'],
      ['yaml/parse', 'ai-writer/posts/yaml/collabo-cafe/shared/broken.yaml'],
      ['yaml/empty', 'ai-writer/posts/yaml/empty.yaml'],
    ]);
    expect(issues[0].message).toContain('duplicated mapping key');
  });

  it('recognizes a templates checkout and the synced copy, and rejects other directories', () => {
    const source = writeTree({ 'ai-writer/config/a.yaml': 'a: 1\n' });
    expect(resolveLayout(source)).toMatchObject({ kind: 'source', configDir: path.join(source, 'ai-writer', 'config') });
    fs.rmSync(source, { recursive: true, force: true });

    const synced = writeTree({ 'config/a.yaml': 'a: 1\n', 'collabo-cafe/_meta.yaml': 'a: 1\n' });
    expect(resolveLayout(synced)).toMatchObject({ kind: 'synced', configDir: path.join(synced, 'config'), templatesDir: synced });
    fs.rmSync(synced, { recursive: true, force: true });

    const other = writeTree({ 'README.md': '' });
    expect(() => resolveLayout(other)).toThrow('is not a templates directory');
  });
});

describe('formatIssues', () => {
  const issues: TemplateIssue[] = [
    { rule: 'title/slug-duplicate', file: 'ai-writer/config/t.yaml', at: 'titles["作品A"]', message: 'slug "work-a" is used by 2 works' },
    { rule: 'title/slug-duplicate', file: 'ai-writer/config/t.yaml', at: 'titles["作品B"]', message: 'slug "work-b" is used by 2 works' },
  ];

  it('prints every issue with its location', () => {
    expect(formatIssues(issues)).toBe(
      [
        'Templates are invalid (2 issues):',
        '- [title/slug-duplicate] ai-writer/config/t.yaml titles["作品A"]: slug "work-a" is used by 2 works',
        '- [title/slug-duplicate] ai-writer/config/t.yaml titles["作品B"]: slug "work-b" is used by 2 works',
      ].join('\n')
    );
  });

  it('redacts values: only rule ids, files and counts', () => {
    const output = formatIssues(issues, { redact: true });
    expect(output).toBe(
      ['Templates are invalid (2 issues, details redacted):', '- title/slug-duplicate in ai-writer/config/t.yaml: 2'].join('\n')
    );
    expect(output).not.toContain('作品');
    expect(output).not.toContain('work-');
  });

  it('says so when there are no issues', () => {
    expect(formatIssues([])).toBe('Templates are valid (0 issues).');
  });
});
