/**
 * Layer A: every YAML file parses (js-yaml rejects duplicate keys) and is not empty.
 *
 * Some loaders swallow parse errors and fall back to defaults (e.g. `shared/placeholders.yaml` in
 * `YamlTemplateLoaderService`), so a broken file would otherwise go unnoticed.
 */
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { TemplateIssue } from './issues';

/** Parsed documents keyed by the path relative to the templates root */
export type ParsedDocs = Map<string, unknown>;

function listYamlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listYamlFiles(full));
    else if (/\.ya?ml$/.test(entry.name)) files.push(full);
  }
  return files.sort();
}

export function parseAllYaml(scanRoot: string, root: string): { docs: ParsedDocs; issues: TemplateIssue[] } {
  const docs: ParsedDocs = new Map();
  const issues: TemplateIssue[] = [];
  for (const file of listYamlFiles(scanRoot)) {
    const rel = path.relative(root, file);
    try {
      const parsed = yaml.load(fs.readFileSync(file, 'utf-8'), { filename: rel });
      if (parsed === undefined || parsed === null) {
        issues.push({ rule: 'yaml/empty', file: rel, message: 'the file has no content' });
        continue;
      }
      docs.set(rel, parsed);
    } catch (error) {
      issues.push({ rule: 'yaml/parse', file: rel, message: errorMessage(error) });
    }
  }
  return { docs, issues };
}

export function errorMessage(error: unknown): string {
  if (error instanceof yaml.YAMLException) {
    return `${error.reason} (line ${error.mark.line + 1}, column ${error.mark.column + 1})`;
  }
  return error instanceof Error ? error.message : String(error);
}
