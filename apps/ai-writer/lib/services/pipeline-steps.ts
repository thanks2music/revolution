/**
 * Pipeline step SoT (Source of Truth).
 *
 * - `id` (semantic kebab-case) is a **persistent contract**: referenced by the
 *   cost-tracker, log aggregation queries, and historical log alignment. Both
 *   `getStepDisplay` and `getStepContext` embed the id in the emitted log line
 *   so Cloud Logging filters can grep on the stable identifier.
 * - The array index (display number `[N/M]`) is **time-varying**: inserting a
 *   new step in the middle changes `[3/18]` to `[4/19]`. Cross-cutting analyses
 *   should align logs by `id`, not by display number.
 *
 * Adding a new step: append (or insert) one entry to `PIPELINE_STEPS`. Do not
 * extend the schema with future-only fields like `requiresAi` until a concrete
 * caller exists (YAGNI).
 *
 * Sub-step convention: a parent step that contains short sub-tasks emits
 * follow-up log lines via `getStepContext(parent-id)` (returns `[parent-id]`)
 * so the id stays grep-stable. The criteria for promoting a sub-task into a
 * top-level entry vs absorbing it as a sub-context are documented at
 * `docs/pipeline.md` → "ステップ追加時の判定基準".
 */

export const PIPELINE_STEPS = [
  { id: 'article-selection',             label: '記事選別 (公式 URL 判定)'                 },
  { id: 'rss-extraction',                label: 'RSS 情報抽出'                              },
  { id: 'detail-extraction',             label: '公式サイト HTML 詳細抽出'                  },
  { id: 'subpage-detection',             label: '下層ページ検出'                            },
  { id: 'category-image-extraction',     label: 'カテゴリ別画像抽出'                        },
  { id: 'vision-api',                    label: 'Vision API 統合 (条件付)'                  },
  { id: 'slug-generation',               label: 'Slug 解決'                                 },
  { id: 'duplication-check',             label: 'Firestore 重複チェック'                    },
  { id: 'metadata-generation',           label: 'メタデータ生成'                            },
  { id: 'title-generation',              label: 'タイトル生成'                              },
  { id: 'content-generation',            label: 'MDX 本文生成'                              },
  { id: 'image-upload-r2',               label: '画像 R2 アップロード (OG + カテゴリ別)'    },
  { id: 'image-placeholder-replacement', label: '画像プレースホルダー置換'                  },
  { id: 'text-placeholder-replacement',  label: 'テキストプレースホルダー置換'              },
  { id: 'footer-placeholder-cleanup',    label: '記事末尾プレースホルダー削除'              },
  { id: 'mdx-assembly',                  label: 'MDX 組み立て'                              },
  { id: 'github-pr-creation',            label: 'GitHub PR 作成 (条件付スキップ)'           },
  { id: 'firestore-status-update',       label: 'Firestore ステータス更新 (条件付スキップ)' },
] as const satisfies readonly { readonly id: string; readonly label: string }[];

export type PipelineStep = typeof PIPELINE_STEPS[number];
export type PipelineStepId = PipelineStep['id'];

/**
 * Resolve `id` to its array entry once, throwing if `PIPELINE_STEPS` has
 * drifted (the `PipelineStepId` type already prevents unknown ids at compile
 * time, so this guard exists only for the runtime-cast escape hatch).
 *
 * Centralizing here keeps `getStepIndex` / `getStepLabel` / `getStepDisplay`
 * to a single `findIndex` pass each instead of stacking calls through
 * `getStepIndex`.
 */
function resolveStep(id: PipelineStepId): { step: PipelineStep; index: number } {
  const index = PIPELINE_STEPS.findIndex((s) => s.id === id);
  if (index === -1) {
    throw new Error(`Unknown pipeline step id: ${id}`);
  }
  return { step: PIPELINE_STEPS[index], index };
}

/** 0-based position of `id` in `PIPELINE_STEPS`. */
export function getStepIndex(id: PipelineStepId): number {
  return resolveStep(id).index;
}

/** Human-readable label without bracket framing. */
export function getStepLabel(id: PipelineStepId): string {
  return resolveStep(id).step.label;
}

/**
 * Entry log line for a top-level step.
 *
 * Format: `[N/M id] label` where N is 1-based, M is the live array length,
 * and `id` is embedded so log queries can grep on the stable identifier even
 * after the array shifts.
 */
export function getStepDisplay(id: PipelineStepId): string {
  const { step, index } = resolveStep(id);
  return `[${index + 1}/${PIPELINE_STEPS.length} ${step.id}] ${step.label}`;
}

/**
 * Sub-context log line emitted from inside a step (after its entry log).
 *
 * Format: `[id]` (no sub-label) or `[id: sub-label]` (with sub-label) — only
 * the id is mandatory, since the entry log already showed the human label
 * and the surrounding lines belong to the same step. Use this instead of
 * hand-wrapping `[${getStepLabel(id)}]` so id-based grep stays consistent.
 */
export function getStepContext(id: PipelineStepId, subLabel?: string): string {
  return subLabel ? `[${id}: ${subLabel}]` : `[${id}]`;
}
