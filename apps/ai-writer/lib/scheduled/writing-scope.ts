import { existsSync, readFileSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import { EventTypeSlugSchema, type EventTypeSlug } from '@revolution/schemas/category';
import { WRITING_SCOPE_PATH } from '../config/types';
import {
  siteOperatorOf,
  type SiteOperator,
  type SiteProfileId,
} from '../utils/source-truth-extractor';

/**
 * The company that runs the cafe, as far as the official site tells us: the operator of the known site
 * structure it matched (`SITE_PROFILES` in `source-truth-extractor.ts`). Anything else is `unknown`:
 * we do not guess the operator from the domain or ask the AI
 */
export type CafeOperator = SiteOperator | 'unknown';

const writingScopeFileSchema = z.object({
  writing_scope: z.array(
    z
      .object({
        category: EventTypeSlugSchema,
        operator: z.enum(['ltr']) satisfies z.ZodType<SiteOperator>,
      })
      .strict()
  ),
});

/**
 * Kind × operator pairs that scheduled runs write from RSS candidates. The pairs are strategy, so they live in
 * the private templates (`config/writing-scope.yaml`), not here
 */
export type WritingScope = z.infer<typeof writingScopeFileSchema>['writing_scope'];

/** Parses the writing-scope file. Throws when it is malformed */
export function parseWritingScope(yamlText: string): WritingScope {
  return writingScopeFileSchema.parse(yamlLoad(yamlText)).writing_scope;
}

let cachedScope: WritingScope | undefined;

/**
 * Reads the writing scope. The file is required: without it a scheduled run cannot tell what to write, so
 * reading fails (the templates validator checks that it is there)
 */
export function loadWritingScope(path: string = WRITING_SCOPE_PATH): WritingScope {
  if (path === WRITING_SCOPE_PATH && cachedScope) return cachedScope;
  if (!existsSync(path)) throw new Error(`The writing scope file is missing: ${path}`);
  try {
    const scope = parseWritingScope(readFileSync(path, 'utf8'));
    if (path === WRITING_SCOPE_PATH) cachedScope = scope;
    return scope;
  } catch (error) {
    throw new Error(
      `Failed to load the writing scope from ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export interface WritingScopeVerdict {
  category: EventTypeSlug;
  operator: CafeOperator;
  inScope: boolean;
  /** Why it is out of scope (only when `inScope` is false) */
  reason?: string;
}

/** `profileId` from `extractSourceTruth` (null when no known site structure matched) */
export function operatorFromProfile(profileId: SiteProfileId | null): CafeOperator {
  return siteOperatorOf(profileId) ?? 'unknown';
}

/**
 * Whether some operator makes this kind writable. When it does and the operator is unknown, the page may be
 * a first report whose venue list (the site structure) is not out yet
 */
export function scopeCoversCategory(category: EventTypeSlug, scope: WritingScope): boolean {
  return scope.some(s => s.category === category);
}

const OPERATOR_LABELS: Record<CafeOperator, string> = {
  ltr: 'LTR',
  unknown: '運営不明',
};

export function judgeWritingScope(
  category: EventTypeSlug,
  operator: CafeOperator,
  scope: WritingScope
): WritingScopeVerdict {
  const inScope = scope.some(s => s.category === category && s.operator === operator);
  if (inScope) return { category, operator, inScope };
  return {
    category,
    operator,
    inScope,
    reason: `書く対象の外 (種別 ${category} / 運営 ${OPERATOR_LABELS[operator]})`,
  };
}

/** One line for logs and the CLI: what a scheduled run would do with this page */
export function describeWritingScope(verdict: WritingScopeVerdict): string {
  return verdict.inScope
    ? `書く (種別 ${verdict.category} / 運営 ${OPERATOR_LABELS[verdict.operator]})`
    : `スキップ: ${verdict.reason}`;
}
