/**
 * Templates validator, layer D (Layer 2: the production loaders are mocked; this checks the wiring —
 * every loader is called with the given directory, a throw becomes an issue, the console stays quiet).
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

const calls: Array<[string, unknown[]]> = [];
const failing = new Set<string>();
/** Prompts the fake pipeline templates hold (every key a service reads, unless a test removes one) */
const prompts: Record<string, string> = {};

function fake(name: string) {
  return (...args: unknown[]) => {
    calls.push([name, args]);
    console.log(`[${name}] loaded`); // the real loaders log; the validator must silence them
    if (failing.has(name)) throw new Error(`${name} failed`);
    return {};
  };
}

jest.mock('@/lib/services/article-points', () => ({ loadPointsFormat: fake('points') }));
jest.mock('@/lib/services/goods-list', () => ({ loadGoodsListConfig: fake('goods') }));
jest.mock('@/lib/services/section-renderers', () => ({
  loadRendered: (file: string, keys: readonly string[], dir: string) => fake(`rendered ${file}`)(keys, dir),
  MENU_RENDERED_KEYS: ['menu-key'],
  NOVELTY_RENDERED_KEYS: ['novelty-key'],
  SUMMARY_VENUE_KEYS: ['venue-key'],
}));
jest.mock('@/lib/services/summary-table', () => ({ SUMMARY_ROWS_KEYS: ['row-key'] }));
jest.mock('@/lib/services/lead-generator.service', () => ({ readLeadSectionYaml: fake('lead') }));
jest.mock('@/lib/services/lead-modifier-config', () => ({
  // the dictionary schemas stay real (layer B reads them)
  ...jest.requireActual('@/lib/services/lead-modifier-config'),
  loadLeadModifierFormat: fake('lead-modifier'),
  loadLeadFallbackPrompt: fake('lead-fallback-prompt'),
  loadWorkDescriptions: fake('work-descriptions'),
  loadCharacterOwners: fake('character-owners'),
}));
jest.mock('@/lib/archive-source/config', () => ({ loadArchiveSources: fake('archive-sources') }));
jest.mock('@/lib/scheduled/writing-scope', () => ({ loadWritingScope: fake('writing-scope') }));
jest.mock('@/lib/services/media-type-mapper.service', () => ({
  MediaTypeMapperService: jest.fn((configPath: string) => fake('media-type-mapper')(configPath)),
}));
jest.mock('@/lib/services/media-form-resolver.service', () => ({
  MediaFormResolverService: jest.fn((configPath: string) => fake('media-form-resolver')(configPath)),
}));
jest.mock('@/lib/services/config-loader.service', () => ({
  ConfigLoaderService: jest.fn((configDir: string) => ({
    loadStoreUrlPatterns: async () => fake('store-url-patterns')(configDir),
  })),
}));
jest.mock('@/lib/services/yaml-template-loader.service', () => ({
  YamlTemplateLoaderService: jest.fn((templatesDir: string) => ({
    loadModularTemplate: async (templateId: string, pipelineId: string) => {
      fake(`pipeline ${pipelineId}`)(templatesDir, templateId);
      return { prompts };
    },
    loadVisionApiTemplate: async (templateId: string) => fake('vision')(templatesDir, templateId),
  })),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PIPELINE_PROMPTS } from '@/lib/services/pipeline-prompts';
import { checkConsumerContract } from '@/lib/templates-validation/consumer-contract';
import type { TemplatesLayout } from '@/lib/templates-validation/layout';
import type { ParsedDocs } from '@/lib/templates-validation/syntax';

const layout: TemplatesLayout = {
  root: '/t',
  configDir: '/t/ai-writer/config',
  templatesDir: '/t/ai-writer/posts/yaml',
  sectionsDir: '/t/ai-writer/posts/yaml/collabo-cafe/sections',
  sharedDir: '/t/ai-writer/posts/yaml/collabo-cafe/shared',
  scanRoot: '/t/ai-writer',
};

const lexicon = {
  version: '1.0.0',
  last_updated: '2026-01-01',
  categories: {
    menu_expressions: { description: 'd', terms: ['t'] },
    goods_expressions: { description: 'd', terms: ['t'] },
    visual_style: { description: 'd', terms: ['t'] },
    world_view: { description: 'd', templates: ['t'] },
    honorifics: { description: 'd', terms: ['t'] },
  },
};

function docs(overrides: Record<string, unknown> = {}): ParsedDocs {
  return new Map(
    Object.entries({
      'ai-writer/posts/yaml/collabo-cafe/_meta.yaml': { pipeline: { order: ['1-selection', '9-listed-only'] } },
      'ai-writer/posts/yaml/collabo-cafe/shared/industry-lexicon.yaml': lexicon,
      'ai-writer/posts/yaml/collabo-cafe/shared/style-guide.yaml': { not: 'checked here' },
      ...overrides,
    })
  );
}

describe('checkConsumerContract', () => {
  beforeEach(() => {
    calls.length = 0;
    failing.clear();
    for (const key of Object.keys(prompts)) delete prompts[key];
    for (const { promptKey } of Object.values(PIPELINE_PROMPTS)) prompts[promptKey] = 'a prompt';
  });

  it('calls every loader with the directories of the given templates', async () => {
    await checkConsumerContract(layout, docs());
    const names = calls.map(([name]) => name);
    expect(names).toEqual([
      'points',
      'rendered 02-menu.yaml',
      'rendered 03-novelty.yaml',
      'goods',
      'rendered 05-summary.yaml',
      'lead',
      'lead-modifier',
      'lead-fallback-prompt',
      'work-descriptions',
      'character-owners',
      'media-type-mapper',
      'media-form-resolver',
      'store-url-patterns',
      'archive-sources',
      'writing-scope',
      'vision',
      // every pipeline a service loads (from PIPELINE_PROMPTS), whatever _meta.yaml lists
      'pipeline 1-selection',
      'pipeline 2-extraction',
      'pipeline 2.5-subpage-extraction',
      'pipeline 3-title',
      'pipeline 4-content',
      'pipeline 4.5-article-points',
      'pipeline 6-meta-description',
    ]);
    const args = Object.fromEntries(calls);
    expect(args['points']).toEqual([layout.sectionsDir]);
    expect(args['rendered 05-summary.yaml']).toEqual([['venue-key', 'row-key'], layout.sectionsDir]);
    expect(args['lead']).toEqual(['/t/ai-writer/posts/yaml/collabo-cafe/sections/01-lead.yaml']);
    expect(args['lead-modifier']).toEqual([layout.sectionsDir]);
    expect(args['lead-fallback-prompt']).toEqual([layout.sectionsDir]);
    expect(args['work-descriptions']).toEqual([layout.configDir]);
    expect(args['character-owners']).toEqual([layout.configDir]);
    expect(args['store-url-patterns']).toEqual([layout.configDir]);
    expect(args['archive-sources']).toEqual(['/t/ai-writer/config/archive-sources.yaml']);
    expect(args['writing-scope']).toEqual(['/t/ai-writer/config/writing-scope.yaml']);
    expect(args['pipeline 3-title']).toEqual([layout.templatesDir, 'collabo-cafe']);
  });

  it('turns a loader error into an issue on that file and keeps checking the rest', async () => {
    failing.add('rendered 05-summary.yaml');
    failing.add('pipeline 3-title');
    const issues = await checkConsumerContract(layout, docs());
    expect(issues.filter((issue) => issue.rule.startsWith('contract/') && issue.rule !== 'contract/shared')).toEqual([
      {
        rule: 'contract/summary',
        file: 'ai-writer/posts/yaml/collabo-cafe/sections/05-summary.yaml',
        message: 'rendered 05-summary.yaml failed',
      },
      { rule: 'contract/pipeline', file: 'ai-writer/posts/yaml/collabo-cafe/pipeline/3-title.yaml', message: 'pipeline 3-title failed' },
    ]);
    expect(calls).toHaveLength(23);
  });

  it('still loads every service pipeline when _meta.yaml is missing (production fails on it too)', async () => {
    await checkConsumerContract(layout, docs({ 'ai-writer/posts/yaml/collabo-cafe/_meta.yaml': undefined }));
    expect(calls.map(([name]) => name).filter((name) => name.startsWith('pipeline '))).toHaveLength(7);
  });

  it('reports a pipeline that lacks the prompt its service reads', async () => {
    delete prompts[PIPELINE_PROMPTS.title.promptKey];
    prompts[PIPELINE_PROMPTS.content.promptKey] = '  ';
    const issues = (await checkConsumerContract(layout, docs())).filter((issue) => issue.rule === 'contract/pipeline');
    expect(issues).toEqual([
      expect.objectContaining({ file: 'ai-writer/posts/yaml/collabo-cafe/pipeline/3-title.yaml', message: expect.stringContaining('prompts.generate_title') }),
      expect.objectContaining({ file: 'ai-writer/posts/yaml/collabo-cafe/pipeline/4-content.yaml', message: expect.stringContaining('prompts.generate_content') }),
    ]);
  });

  it('skips a check whose file the syntax layer already reported', async () => {
    failing.add('rendered 05-summary.yaml');
    const issues = await checkConsumerContract(layout, docs(), new Set(['ai-writer/posts/yaml/collabo-cafe/sections/05-summary.yaml']));
    expect(issues.some((issue) => issue.rule === 'contract/summary')).toBe(false);
    expect(calls.some(([name]) => name === 'rendered 05-summary.yaml')).toBe(false);
  });

  it('reports a section _meta.yaml lists whose file is missing, and an entry that is not a file name', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-contract-'));
    try {
      const sectionsDir = path.join(root, 'ai-writer/posts/yaml/collabo-cafe/sections');
      fs.mkdirSync(sectionsDir, { recursive: true });
      fs.writeFileSync(path.join(sectionsDir, '02-menu.yaml'), 'a: 1\n');
      const tmpLayout: TemplatesLayout = {
        ...layout,
        root,
        templatesDir: path.join(root, 'ai-writer/posts/yaml'),
        sectionsDir,
        sharedDir: path.join(root, 'ai-writer/posts/yaml/collabo-cafe/shared'),
      };
      const issues = await checkConsumerContract(
        tmpLayout,
        docs({ 'ai-writer/posts/yaml/collabo-cafe/_meta.yaml': { sections: { order: ['02-menu', '06-missing', '../x y'] } } })
      );
      expect(issues.filter((issue) => issue.rule === 'contract/section').map((issue) => issue.message)).toEqual([
        'sections.order lists 06-missing, but ai-writer/posts/yaml/collabo-cafe/sections/06-missing.yaml does not exist',
        'sections.order has an entry that is not a section file name',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks the shared lexicon and style guide against their schemas', async () => {
    const issues = await checkConsumerContract(layout, docs());
    expect(issues.map((issue) => [issue.rule, issue.file])).toEqual(
      expect.arrayContaining([['schema/style-guide', 'ai-writer/posts/yaml/collabo-cafe/shared/style-guide.yaml']])
    );
    expect(issues.some((issue) => issue.file.endsWith('industry-lexicon.yaml'))).toBe(false);
  });

  it('reports a shared file that is missing', async () => {
    const issues = await checkConsumerContract(
      layout,
      docs({ 'ai-writer/posts/yaml/collabo-cafe/shared/industry-lexicon.yaml': undefined })
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ rule: 'contract/shared', file: 'ai-writer/posts/yaml/collabo-cafe/shared/industry-lexicon.yaml' })
    );
  });

  it('keeps the loaders quiet and restores the console', async () => {
    const original = console.log;
    const seen: unknown[] = [];
    console.log = (...args: unknown[]) => seen.push(args);
    try {
      await checkConsumerContract(layout, docs());
      expect(seen).toEqual([]);
      console.log('after');
      expect(seen).toEqual([['after']]);
    } finally {
      console.log = original;
    }
  });
});
