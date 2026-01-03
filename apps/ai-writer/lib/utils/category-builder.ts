/**
 * Category Builder Utility
 *
 * taxonomy.yaml v1.1 の category_rules に従って categories を決定論的に構築
 *
 * @module lib/utils/category-builder
 * @see templates/config/taxonomy.yaml
 * @see notes/01-project-docs/05-ai-writer/mdx/AI-Writer-Deterministic-Category-Generation.md
 */

/**
 * buildCategories のパラメータ
 */
export interface BuildCategoriesParams {
  /** 作品名（日本語） */
  workTitle: string;
  /** イベント種別名（日本語、例: コラボカフェ、ポップアップストア） */
  eventTitle: string;
}

/**
 * taxonomy.yaml v1.1 の category_rules に従って categories を決定論的に構築
 *
 * @description
 * AI の自由生成ではなく、既存フィールドから決定論的にカテゴリを生成する。
 * taxonomy.yaml v1.1 の category_rules.generation_order に準拠:
 *   1. work_title（必須）
 *   2. event_title（必須）
 *
 * 注意: prefectures は categories に含めず、別フィールド（prefectures[]）で管理
 *
 * @param params - 作品名とイベント種別名
 * @returns categories 配列（最大2件固定）
 *
 * @example
 * ```typescript
 * const categories = buildCategories({
 *   workTitle: '呪術廻戦',
 *   eventTitle: 'コラボカフェ',
 * });
 * // => ['呪術廻戦', 'コラボカフェ']
 * ```
 *
 * @see templates/config/taxonomy.yaml
 * @see notes/work-report/2025-12/2025-12-16-カテゴリの改善案について改めて行った調査内容.md
 */
export function buildCategories(params: BuildCategoriesParams): string[] {
  const categories: string[] = [];

  // Priority 1: 作品名（必須）
  if (params.workTitle) {
    categories.push(params.workTitle);
  }

  // Priority 2: イベント種別名（必須）
  if (params.eventTitle) {
    categories.push(params.eventTitle);
  }

  // 制約: 2件固定（taxonomy.yaml v1.1 constraints）
  // prefectures は別フィールドで管理するため、ここでは含めない
  return categories;
}
