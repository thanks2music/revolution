/**
 * Pipeline step SoT (Source of Truth).
 *
 * - `id` (semantic kebab-case) is a **persistent contract**: referenced by the
 *   cost-tracker, log aggregation queries, and historical log alignment.
 * - The array index (display number `[N/M]`) is **time-varying**: inserting a
 *   new step in the middle changes `[3/18]` to `[4/19]`. Cross-cutting analyses
 *   should align logs by `id`, not by display number.
 *
 * Adding a new step: append (or insert) one entry to `PIPELINE_STEPS`. Do not
 * extend the schema with future-only fields like `requiresAi` until a concrete
 * caller exists (YAGNI).
 *
 * Sub-step display convention: a parent step that contains short sub-tasks
 * surfaces them as `[parent-id: sub-label]` in its own log lines, rather than
 * adding fractional / suffixed entries here. See § 2.2 of the migration plan
 * for the criteria distinguishing top-level steps from sub-contexts.
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

/** 0-based position of `id` in `PIPELINE_STEPS`. Used for display ordering. */
export function getStepIndex(id: PipelineStepId): number {
  const index = PIPELINE_STEPS.findIndex((s) => s.id === id);
  // The PipelineStepId type guarantees the id exists at compile time;
  // we still surface a runtime error if PIPELINE_STEPS drifts under us.
  if (index === -1) {
    throw new Error(`Unknown pipeline step id: ${id}`);
  }
  return index;
}

/** Human-readable label without bracket framing. */
export function getStepLabel(id: PipelineStepId): string {
  return PIPELINE_STEPS[getStepIndex(id)].label;
}

/** `[N/M] Label` where N is 1-based and M is the live array length. */
export function getStepDisplay(id: PipelineStepId): string {
  const index = getStepIndex(id);
  return `[${index + 1}/${PIPELINE_STEPS.length}] ${PIPELINE_STEPS[index].label}`;
}
