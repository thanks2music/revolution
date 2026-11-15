/**
 * Layer D: the templates can be read by the code that reads them in production.
 *
 * Each check calls the real loader (or its required-key list) with the given directory, so this layer follows
 * the code: when the code starts requiring a new key, the validator requires it too.
 */
import * as path from 'path';
import { IndustryLexiconConfigSchema } from '@revolution/schemas/industry-lexicon';
import { StyleGuideConfigSchema } from '@revolution/schemas/style-guide';
import { loadPointsFormat } from '@/lib/services/article-points';
import { ConfigLoaderService } from '@/lib/services/config-loader.service';
import { loadGoodsListConfig } from '@/lib/services/goods-list';
import { readLeadSectionYaml } from '@/lib/services/lead-generator.service';
import { MediaFormResolverService } from '@/lib/services/media-form-resolver.service';
import { MediaTypeMapperService } from '@/lib/services/media-type-mapper.service';
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

interface Check {
  name: string;
  file: string;
  run: () => unknown;
}

export async function checkConsumerContract(layout: TemplatesLayout, docs: ParsedDocs): Promise<TemplateIssue[]> {
  const { configDir, sectionsDir, sharedDir, templatesDir } = layout;
  const loader = new YamlTemplateLoaderService(templatesDir);
  const rel = (file: string) => path.relative(layout.root, file);

  const checks: Check[] = [
    { name: 'points', file: path.join(sectionsDir, '01b-points.yaml'), run: () => loadPointsFormat(sectionsDir) },
    {
      name: 'menu',
      file: path.join(sectionsDir, '02-menu.yaml'),
      run: () => loadRendered('02-menu.yaml', MENU_RENDERED_KEYS, sectionsDir),
    },
    {
      name: 'novelty',
      file: path.join(sectionsDir, '03-novelty.yaml'),
      run: () => loadRendered('03-novelty.yaml', NOVELTY_RENDERED_KEYS, sectionsDir),
    },
    { name: 'goods', file: path.join(sectionsDir, '04-goods.yaml'), run: () => loadGoodsListConfig(sectionsDir) },
    {
      name: 'summary',
      file: path.join(sectionsDir, '05-summary.yaml'),
      run: () => loadRendered('05-summary.yaml', [...SUMMARY_VENUE_KEYS, ...SUMMARY_ROWS_KEYS], sectionsDir),
    },
    { name: 'lead', file: path.join(sectionsDir, '01-lead.yaml'), run: () => readLeadSectionYaml(path.join(sectionsDir, '01-lead.yaml')) },
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
      name: 'vision-template',
      file: path.join(templatesDir, TEMPLATE_ID, 'pipeline', `${VISION_PIPELINE_ID}.yaml`),
      run: () => loader.loadVisionApiTemplate(TEMPLATE_ID),
    },
  ];

  for (const pipelineId of pipelineOrder(layout, docs)) {
    if (pipelineId === VISION_PIPELINE_ID) continue;
    checks.push({
      name: `pipeline ${pipelineId}`,
      file: path.join(templatesDir, TEMPLATE_ID, 'pipeline', `${pipelineId}.yaml`),
      run: () => loader.loadModularTemplate(TEMPLATE_ID, pipelineId),
    });
  }

  const issues: TemplateIssue[] = [];
  await withQuietConsole(async () => {
    for (const check of checks) {
      try {
        await check.run();
      } catch (error) {
        issues.push({ rule: `contract/${check.name.split(' ')[0]}`, file: rel(check.file), message: errorMessage(error) });
      }
    }
  });

  for (const [file, schema] of [
    ['industry-lexicon.yaml', IndustryLexiconConfigSchema],
    ['style-guide.yaml', StyleGuideConfigSchema],
  ] as const) {
    const docPath = rel(path.join(sharedDir, file));
    const doc = docs.get(docPath);
    if (doc === undefined) {
      issues.push({ rule: 'contract/shared', file: docPath, message: 'the file does not exist or failed to parse' });
      continue;
    }
    issues.push(...schemaIssues(schema, doc, docPath));
  }
  return issues;
}

/** Pipeline files in `_meta.yaml` order (the list the loader itself follows) */
function pipelineOrder(layout: TemplatesLayout, docs: ParsedDocs): string[] {
  const meta = docs.get(path.relative(layout.root, path.join(layout.templatesDir, TEMPLATE_ID, '_meta.yaml'))) as
    | { pipeline?: { order?: unknown } }
    | undefined;
  const order = meta?.pipeline?.order;
  return Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : [];
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
