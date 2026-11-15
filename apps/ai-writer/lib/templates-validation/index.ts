/**
 * Validates the YAML in the private templates repo (dictionaries, prompts, section formats).
 *
 * Layers:
 * - A `syntax.ts`: every YAML file parses (no duplicate keys) and is not empty
 * - B `dictionaries.ts`: the shape of each dictionary in `config/`
 * - C `cross-file.ts`: rules across entries and files (one slug per work, one slug per alias, references)
 * - D `consumer-contract.ts`: the production loaders can read the files (required keys)
 *
 * Used by `scripts/validate-templates.ts` (the templates repo CI, the editing hook, and the job deploy).
 * The code holds no dictionary values; tests use made-up fixtures.
 */
import { checkConsumerContract } from './consumer-contract';
import { checkCrossFile } from './cross-file';
import { checkDictionaries } from './dictionaries';
import type { TemplateIssue } from './issues';
import { resolveLayout } from './layout';
import { parseAllYaml } from './syntax';

export { formatIssues, type TemplateIssue } from './issues';
export { TemplatesLayoutError } from './layout';

export async function validateTemplates(dir: string): Promise<TemplateIssue[]> {
  const layout = resolveLayout(dir);
  const { docs, issues: syntaxIssues } = parseAllYaml(layout.scanRoot, layout.root);
  const failedToParse = new Set(syntaxIssues.map((issue) => issue.file));
  return [
    ...syntaxIssues,
    ...checkDictionaries(layout, docs, failedToParse),
    ...checkCrossFile(layout, docs),
    ...(await checkConsumerContract(layout, docs, failedToParse)),
  ];
}
