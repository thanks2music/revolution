/**
 * 連体修飾語の文言と辞書を Templates から読む (Layer 2、ファイルの読み込み)。
 *
 * - `sections/01-lead.yaml` の `modifier` (形ごとの文言) と `fallback_prompt`
 * - `config/work-descriptions.yaml` (作品の説明) と `config/character-owners.yaml` (© → 持ち主)
 *
 * どれも必須。欠けたら名前を挙げて止める (Templates が古いと、文言が「undefined」で記事に出るため)。
 * templates の検証 (`validate:templates`) も同じ関数を通す。
 */

import * as fs from 'fs';
import * as path from 'path';

import yaml from 'js-yaml';
import { z } from 'zod';

import type { CharacterOwner, LeadModifierFormat, WorkDescription } from './lead-modifier';
import { LEAD_MODIFIER_KEYS, normalizeWorkTitle } from './lead-modifier';
import { loadChecked, loadSectionYaml } from './section-renderers';

const NonEmpty = z.string().min(1);

// 中身が空の辞書 (`work_descriptions:` だけ = YAML の null) は、空として読む
export const WorkDescriptionsSchema = z.object({
  work_descriptions: z
    .record(NonEmpty, z.object({ modifier: NonEmpty, aliases: z.array(NonEmpty).optional() }))
    .nullable()
    .transform((value) => value ?? {}),
});

export const CharacterOwnersSchema = z.object({
  character_owners: z
    .array(z.object({ owner: NonEmpty, patterns: z.array(NonEmpty).min(1) }))
    .nullable()
    .transform((value) => value ?? []),
});

/** `fallback_prompt` の {{…}} に使ってよい名前 (LeadGeneratorService が埋める物だけ。ほかは空で LLM に届くため止める) */
export const LEAD_FALLBACK_PROMPT_KEYS = [
  '作品名',
  '店舗名',
  'メディアタイプ',
  '原作タイプ',
  '原作者名',
  'キャラクター名',
  'メディア形態表記',
  '複数作品コラボ',
  '理由',
] as const;

export const WORK_DESCRIPTIONS_FILE = 'work-descriptions.yaml';
export const CHARACTER_OWNERS_FILE = 'character-owners.yaml';

function readConfig<T>(configDir: string, file: string, schema: z.ZodType<T, unknown>): T {
  const filePath = path.join(configDir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} がありません。pnpm sync:templates で Templates を同期してください`);
  }
  const result = schema.safeParse(yaml.load(fs.readFileSync(filePath, 'utf-8')));
  if (!result.success) {
    throw new Error(`${filePath} の形が違います: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join(' / ')}`);
  }
  return result.data;
}

/**
 * 作品の説明を読む。作品名と別名は 1 つの作品だけを指す (重なると、どちらの文を使うかが辞書の並び順で決まってしまうため止める)
 */
export function loadWorkDescriptions(configDir: string): Record<string, WorkDescription> {
  const { work_descriptions } = readConfig(configDir, WORK_DESCRIPTIONS_FILE, WorkDescriptionsSchema);
  const owners = new Map<string, string>();
  for (const [name, entry] of Object.entries(work_descriptions)) {
    for (const label of [name, ...(entry.aliases ?? [])].map(normalizeWorkTitle)) {
      const other = owners.get(label);
      if (other !== undefined && other !== name) {
        throw new Error(`${WORK_DESCRIPTIONS_FILE}: 「${label}」が「${other}」と「${name}」の両方にあります`);
      }
      owners.set(label, name);
    }
  }
  return work_descriptions;
}

export function loadCharacterOwners(configDir: string): CharacterOwner[] {
  return readConfig(configDir, CHARACTER_OWNERS_FILE, CharacterOwnersSchema).character_owners;
}

/** `01-lead.yaml` の `modifier` (形ごとの文言)。全キーがあることを確かめる */
export function loadLeadModifierFormat(sectionsDir: string): LeadModifierFormat {
  return loadChecked<LeadModifierFormat>('01-lead.yaml', 'modifier', LEAD_MODIFIER_KEYS, sectionsDir);
}

/** `01-lead.yaml` の `fallback_prompt` (LLM フォールバックのプロンプト。{{…}} は呼び出し側が埋める) */
export function loadLeadFallbackPrompt(sectionsDir: string): string {
  const prompt = loadSectionYaml<unknown>('01-lead.yaml', 'fallback_prompt', sectionsDir);
  const file = path.join(sectionsDir, '01-lead.yaml');
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error(`${file} の fallback_prompt が空です`);
  }
  const allowed = new Set<string>(LEAD_FALLBACK_PROMPT_KEYS);
  const unknown = [...prompt.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1].trim()).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${file} の fallback_prompt に、Revolution が埋めない {{${unknown.join('}} / {{')}}} があります`);
  }
  return prompt;
}
