/**
 * Templates validator, layer D (Layer 2: the production loaders are mocked; this checks the wiring —
 * every loader is called with the given directory, a throw becomes an issue, the console stays quiet).
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

const calls: Array<[string, unknown[]]> = [];
const failing = new Set<string>();

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
jest.mock('@/lib/archive-source/config', () => ({ loadArchiveSources: fake('archive-sources') }));
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
    loadModularTemplate: async (templateId: string, pipelineId: string) =>
      fake(`pipeline ${pipelineId}`)(templatesDir, templateId),
    loadVisionApiTemplate: async (templateId: string) => fake('vision')(templatesDir, templateId),
  })),
}));

import { checkConsumerContract } from '@/lib/templates-validation/consumer-contract';
import type { TemplatesLayout } from '@/lib/templates-validation/layout';
import type { ParsedDocs } from '@/lib/templates-validation/syntax';

const layout: TemplatesLayout = {
  kind: 'source',
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
      'ai-writer/posts/yaml/collabo-cafe/_meta.yaml': { pipeline: { order: ['1-selection', '1.5-vision-extraction', '3-title'] } },
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
      'media-type-mapper',
      'media-form-resolver',
      'store-url-patterns',
      'archive-sources',
      'vision',
      'pipeline 1-selection',
      'pipeline 3-title', // the vision pipeline is loaded once, through loadVisionApiTemplate
    ]);
    const args = Object.fromEntries(calls);
    expect(args['points']).toEqual([layout.sectionsDir]);
    expect(args['rendered 05-summary.yaml']).toEqual([['venue-key', 'row-key'], layout.sectionsDir]);
    expect(args['lead']).toEqual(['/t/ai-writer/posts/yaml/collabo-cafe/sections/01-lead.yaml']);
    expect(args['store-url-patterns']).toEqual([layout.configDir]);
    expect(args['archive-sources']).toEqual(['/t/ai-writer/config/archive-sources.yaml']);
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
    expect(calls).toHaveLength(13);
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
