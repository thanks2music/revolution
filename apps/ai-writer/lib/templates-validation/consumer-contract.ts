/**
 * Layer D: the templates can be read by the code that reads them in production.
 *
 * Each check calls the real loader (or its required-key list) with the given directory, so this layer follows
 * the code: when the code starts requiring a new key, the validator requires it too.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IndustryLexiconConfigSchema } from '@revolution/schemas/industry-lexicon';
import { StyleGuideConfigSchema } from '@revolution/schemas/style-guide';
import { loadArchiveSources } from '@/lib/archive-source/config';
import { loadWritingScope } from '@/lib/scheduled/writing-scope';
import { loadPointsFormat } from '@/lib/services/article-points';
import { ConfigLoaderService } from '@/lib/services/config-loader.service';
import { loadGoodsListConfig } from '@/lib/services/goods-list';
import { readLeadSectionYaml } from '@/lib/services/lead-generator.service';
import {
  loadCharacterOwners,
  loadLeadFallbackPrompt,
  loadLeadModifierFormat,
  loadWorkDescriptions,
} from '@/lib/services/lead-modifier-config';
import { MediaFormResolverService } from '@/lib/services/media-form-resolver.service';
import { MediaTypeMapperService } from '@/lib/services/media-type-mapper.service';
import { PIPELINE_PROMPTS } from '@/lib/services/pipeline-prompts';
import {
  loadRendered,
  MENU_RENDERED_KEYS,
  NOVELTY_RENDERED_KEYS,
  SUMMARY_VENUE_KEYS,
} from '@/lib/services/section-renderers';
import { SUMMARY_ROWS_KEYS } from '@/lib/services/summary-table';
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import { schemaIssues } from './dictionaries';
import type { TemplateIssue } from './issues';
import { TEMPLATE_ID, type TemplatesLayout } from './layout';
import { errorMessage, type ParsedDocs } from './syntax';

/** Loaded through `loadVisionApiTemplate`, not `loadModularTemplate` */
const VISION_PIPELINE_ID = '1.5-vision-extraction';

/** A section id becomes part of a printed file name (`--redact` prints file names); anything else is reported on `_meta.yaml` */
const FILE_ID = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

interface Check {
  name: string;
  file: string;
  run: () => unknown;
}

export async function checkConsumerContract(
  layout: TemplatesLayout,
  docs: ParsedDocs,
  failedToParse: ReadonlySet<string> = new Set()
): Promise<TemplateIssue[]> {
  const { configDir, sectionsDir, sharedDir, templatesDir } = layout;
  const loader = new YamlTemplateLoaderService(templatesDir);
  const rel = (file: string) => path.relative(layout.root, file);
  const pipelineFile = (id: string) => path.join(templatesDir, TEMPLATE_ID, 'pipeline', `${id}.yaml`);

  const checks: Check[] = [
    { name: 'points', file: path.join(sectionsDir, '01b-points.yaml'), run: () => loadPointsFormat(sectionsDir) },
    {
      name: 'menu',
      file: path.join(sectionsDir, '02-menu.yaml'),
      run: () => loadRendered<Record<string, unknown>>('02-menu.yaml', MENU_RENDERED_KEYS, sectionsDir),
    },
    {
      name: 'novelty',
      file: path.join(sectionsDir, '03-novelty.yaml'),
      run: () => loadRendered<Record<string, unknown>>('03-novelty.yaml', NOVELTY_RENDERED_KEYS, sectionsDir),
    },
    { name: 'goods', file: path.join(sectionsDir, '04-goods.yaml'), run: () => loadGoodsListConfig(sectionsDir) },
    {
      name: 'summary',
      file: path.join(sectionsDir, '05-summary.yaml'),
      run: () => loadRendered<Record<string, unknown>>('05-summary.yaml', [...SUMMARY_VENUE_KEYS, ...SUMMARY_ROWS_KEYS], sectionsDir),
    },
    { name: 'lead', file: path.join(sectionsDir, '01-lead.yaml'), run: () => readLeadSectionYaml(path.join(sectionsDir, '01-lead.yaml')) },
    { name: 'lead-modifier', file: path.join(sectionsDir, '01-lead.yaml'), run: () => loadLeadModifierFormat(sectionsDir) },
    { name: 'lead-fallback-prompt', file: path.join(sectionsDir, '01-lead.yaml'), run: () => loadLeadFallbackPrompt(sectionsDir) },
    // the alias check (a name or alias pointing at two works) lives in the loader
    { name: 'work-descriptions', file: path.join(configDir, 'work-descriptions.yaml'), run: () => loadWorkDescriptions(configDir) },
    { name: 'character-owners', file: path.join(configDir, 'character-owners.yaml'), run: () => loadCharacterOwners(configDir) },
    {
      name: 'media-type-mapper',
      file: path.join(configDir, 'media-type-mapping.yaml'),
      run: () => new MediaTypeMapperService(path.join(configDir, 'media-type-mapping.yaml')),
    },
    {
      name: 'media-form-resolver',
      file: path.join(configDir, 'media-type-mapping.yaml'),
      run: () => new MediaFormResolverService(path.join(configDir, 'media-type-mapping.yaml')),
    },
    {
      name: 'store-url-patterns',
      file: path.join(configDir, 'store-url-patterns.yaml'),
      run: () => new ConfigLoaderService(configDir).loadStoreUrlPatterns(),
    },
    {
      // optional file: an absent file turns the feature off, a malformed one throws
      name: 'archive-sources',
      file: path.join(configDir, 'archive-sources.yaml'),
      run: () => loadArchiveSources(path.join(configDir, 'archive-sources.yaml')),
    },
    {
      // required: scheduled runs read it to decide what to write from RSS
      name: 'writing-scope',
      file: path.join(configDir, 'writing-scope.yaml'),
      run: () => loadWritingScope(path.join(configDir, 'writing-scope.yaml')),
    },
    { name: 'vision-template', file: pipelineFile(VISION_PIPELINE_ID), run: () => loader.loadVisionApiTemplate(TEMPLATE_ID) },
    // Every pipeline a service loads, with the prompt it reads (a missing prompt would reach the model as "undefined")
    ...Object.values(PIPELINE_PROMPTS).map(({ pipelineId, promptKey }) => ({
      name: 'pipeline',
      file: pipelineFile(pipelineId),
      run: async () => {
        const template = await loader.loadModularTemplate(TEMPLATE_ID, pipelineId);
        const prompt: unknown = template.prompts?.[promptKey];
        if (typeof prompt !== 'string' || prompt.trim() === '') {
          throw new Error(`prompts.${promptKey} is missing or empty (the service reads it)`);
        }
      },
    })),
  ];

  const issues: TemplateIssue[] = [];
  await withQuietConsole(async () => {
    for (const check of checks) {
      if (failedToParse.has(rel(check.file))) continue; // already reported by the syntax layer
      try {
        await check.run();
      } catch (error) {
        issues.push({ rule: `contract/${check.name}`, file: rel(check.file), message: errorMessage(error) });
      }
    }
  });

  issues.push(...checkSectionFiles(layout, docs, rel));

  for (const [file, schema] of [
    ['industry-lexicon.yaml', IndustryLexiconConfigSchema],
    ['style-guide.yaml', StyleGuideConfigSchema],
  ] as const) {
    const docPath = rel(path.join(sharedDir, file));
    if (failedToParse.has(docPath)) continue;
    const doc = docs.get(docPath);
    if (doc === undefined) {
      issues.push({ rule: 'contract/shared', file: docPath, message: 'the file does not exist' });
      continue;
    }
    issues.push(...schemaIssues(schema, doc, docPath));
  }
  return issues;
}

/**
 * Every section `_meta.yaml` lists (`sections.order`) has its file. The loader skips a missing section with only
 * a warning, so articles would silently lose it.
 */
function checkSectionFiles(layout: TemplatesLayout, docs: ParsedDocs, rel: (file: string) => string): TemplateIssue[] {
  const metaPath = path.join(layout.templatesDir, TEMPLATE_ID, '_meta.yaml');
  const order = (docs.get(rel(metaPath)) as { sections?: { order?: unknown } } | undefined)?.sections?.order;
  if (!Array.isArray(order)) return [];
  const issues: TemplateIssue[] = [];
  for (const id of order) {
    if (typeof id !== 'string' || !FILE_ID.test(id)) {
      issues.push({ rule: 'contract/section', file: rel(metaPath), message: 'sections.order has an entry that is not a section file name' });
      continue;
    }
    const file = path.join(layout.sectionsDir, `${id}.yaml`);
    if (!fs.existsSync(file)) {
      issues.push({ rule: 'contract/section', file: rel(metaPath), message: `sections.order lists ${id}, but ${rel(file)} does not exist` });
    }
  }
  return issues;
}

/** The loaders log every load; keep the validator's output to the issues */
async function withQuietConsole(fn: () => Promise<void>): Promise<void> {
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = () => {};
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
}
