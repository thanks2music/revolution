import { EventTypeSlugSchema, type EventTypeSlug } from '@revolution/schemas/category';
import type { ExistingArticleFields } from '../mdx/article-update';

export type ArticleEventTypeResult =
  { ok: true; eventType: EventTypeSlug } | { ok: false; reason: string };

/**
 * The article's `event_type`: the kind the extraction chose (`event_data.primary_category_slug`, one of
 * the five kinds). We do not fall back to the RSS extraction's free-text event type name or to an
 * AI-made slug: that path wrote values outside the five kinds (`goods-sales` and so on).
 *
 * When updating a published article, the existing article's `event_type` wins: it is in the article's
 * path, and the update stops when it changes (`findSlugChanges`). A re-extraction that picks another kind
 * would otherwise stop every update.
 */
export function resolveArticleEventType(
  eventData: unknown,
  existing?: Pick<ExistingArticleFields, 'eventType'>
): ArticleEventTypeResult {
  const value = existing
    ? existing.eventType
    : (eventData as { primary_category_slug?: unknown } | null | undefined)?.primary_category_slug;
  const parsed = EventTypeSlugSchema.safeParse(value);
  if (parsed.success) return { ok: true, eventType: parsed.data };
  const source = existing ? '既存の記事' : '抽出結果';
  return {
    ok: false,
    reason: `種別を判定できない (${source}の値: ${JSON.stringify(value ?? null)})`,
  };
}
