/**
 * Where the templates live under a given directory.
 *
 * Two layouts are accepted:
 * - `source`: a checkout of the private templates repo (`<root>/ai-writer/config`, `<root>/ai-writer/posts/yaml/<template>`)
 * - `synced`: the copy `pnpm sync:templates` writes (`apps/ai-writer/templates/config`, `apps/ai-writer/templates/<template>`)
 */
import * as fs from 'fs';
import * as path from 'path';

export const TEMPLATE_ID = 'collabo-cafe';

export interface TemplatesLayout {
  kind: 'source' | 'synced';
  root: string;
  /** Directory of the dictionaries (`brand-slugs.yaml`, `title-romaji-mapping.yaml`, …) */
  configDir: string;
  /** Directory that `YamlTemplateLoaderService` takes (it holds `<TEMPLATE_ID>/`) */
  templatesDir: string;
  /** `<templatesDir>/<TEMPLATE_ID>/sections` */
  sectionsDir: string;
  /** `<templatesDir>/<TEMPLATE_ID>/shared` */
  sharedDir: string;
  /** Directory to scan for every YAML file */
  scanRoot: string;
}

export function resolveLayout(dir: string): TemplatesLayout {
  const root = path.resolve(dir);
  const sourceConfig = path.join(root, 'ai-writer', 'config');
  if (fs.existsSync(sourceConfig)) {
    return build('source', root, sourceConfig, path.join(root, 'ai-writer', 'posts', 'yaml'), path.join(root, 'ai-writer'));
  }
  if (fs.existsSync(path.join(root, 'config')) && fs.existsSync(path.join(root, TEMPLATE_ID))) {
    return build('synced', root, path.join(root, 'config'), root, root);
  }
  throw new Error(
    `${root} is not a templates directory: expected ai-writer/config (a templates checkout) ` +
      `or config/ and ${TEMPLATE_ID}/ (the synced copy)`
  );
}

function build(
  kind: TemplatesLayout['kind'],
  root: string,
  configDir: string,
  templatesDir: string,
  scanRoot: string
): TemplatesLayout {
  const templateDir = path.join(templatesDir, TEMPLATE_ID);
  return {
    kind,
    root,
    configDir,
    templatesDir,
    sectionsDir: path.join(templateDir, 'sections'),
    sharedDir: path.join(templateDir, 'shared'),
    scanRoot,
  };
}
