/**
 * occurrence 取り込みの実行層 (Layer 2、外部副作用境界)
 *
 * `plan-ingest.ts` (純粋関数) が算出した実行計画を staging Supabase へ書く。
 * - snapshot 取得と書き込みだけを担い、判断ロジックは持たない
 * - **event 単位のトランザクション**: 1 event の失敗が他 event の取り込みを止めない
 * - 冪等: events は slug、occurrences は (event_id, slug) を自然キーに upsert
 */
import { and, eq, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';

import { categories } from '@revolution/schemas/db/categories';
import { eventCategories } from '@revolution/schemas/db/event-categories';
import { eventTitles } from '@revolution/schemas/db/event-titles';
import { events } from '@revolution/schemas/db/events';
import { occurrences } from '@revolution/schemas/db/occurrences';
import { titleAliases } from '@revolution/schemas/db/title-aliases';
import { titles } from '@revolution/schemas/db/titles';
import { venueAliases } from '@revolution/schemas/db/venue-aliases';
import { venues } from '@revolution/schemas/db/venues';

import type { IngestPlan, MasterSnapshot } from './plan-ingest';

type Db = ReturnType<typeof drizzle>;

export async function fetchSnapshot(db: Db): Promise<MasterSnapshot> {
  const [categoryRows, titleRows, titleAliasRows, venueRows, venueAliasRows, eventRows, occurrenceRows] =
    await Promise.all([
      db.select({ id: categories.id, slug: categories.slug }).from(categories),
      db.select({ id: titles.id, slug: titles.slug }).from(titles),
      db.select({ alias: titleAliases.alias, titleId: titleAliases.titleId }).from(titleAliases),
      db.select({ id: venues.id, slug: venues.slug }).from(venues),
      db.select({ alias: venueAliases.alias, venueId: venueAliases.venueId }).from(venueAliases),
      db.select({ id: events.id, slug: events.slug }).from(events),
      db
        .select({
          eventId: occurrences.eventId,
          slug: occurrences.slug,
          startsOn: occurrences.startsOn,
          endsOn: occurrences.endsOn,
          verified: occurrences.verified,
        })
        .from(occurrences),
    ]);

  const venueSlugById = new Map(venueRows.map((v) => [v.id, v.slug]));
  const eventSlugById = new Map(eventRows.map((e) => [e.id, e.slug]));

  const existingOccurrences = new Map<
    string,
    Array<{ slug: string; startsOn: string | null; endsOn: string | null; verified: boolean }>
  >();
  for (const row of occurrenceRows) {
    const eventSlug = eventSlugById.get(row.eventId);
    if (eventSlug === undefined) continue;
    const rows = existingOccurrences.get(eventSlug) ?? [];
    rows.push({ slug: row.slug, startsOn: row.startsOn, endsOn: row.endsOn, verified: row.verified });
    existingOccurrences.set(eventSlug, rows);
  }

  return {
    categoryIdBySlug: new Map(categoryRows.map((c) => [c.slug, c.id])),
    titleIdBySlug: new Map(titleRows.map((t) => [t.slug, t.id])),
    titleIdByAlias: new Map(titleAliasRows.map((a) => [a.alias, a.titleId])),
    venueIdBySlug: new Map(venueRows.map((v) => [v.slug, v.id])),
    venueByAlias: new Map(
      venueAliasRows
        .filter((a) => venueSlugById.has(a.venueId))
        .map((a) => [a.alias, { id: a.venueId, slug: venueSlugById.get(a.venueId)! }]),
    ),
    existingOccurrences,
  };
}

export interface ExecuteResult {
  eventsUpserted: number;
  occurrencesInserted: number;
  occurrencesUpdated: number;
  eventTitlesUpserted: number;
  eventCategoriesUpserted: number;
  /** event 単位の失敗 (他 event は続行済み) */
  failures: Array<{ eventSlug: string; message: string }>;
}

export async function executePlan(db: Db, plan: IngestPlan): Promise<ExecuteResult> {
  const result: ExecuteResult = {
    eventsUpserted: 0,
    occurrencesInserted: 0,
    occurrencesUpdated: 0,
    eventTitlesUpserted: 0,
    eventCategoriesUpserted: 0,
    failures: [],
  };

  for (const plannedEvent of plan.events) {
    const eventSlug = plannedEvent.slug;
    try {
      await db.transaction(async (tx) => {
        const [eventRow] = await tx
          .insert(events)
          .values({
            slug: plannedEvent.slug,
            name: plannedEvent.name,
            primaryCategoryId: plannedEvent.primaryCategoryId,
            officialUrl: plannedEvent.officialUrl,
          })
          .onConflictDoUpdate({
            target: events.slug,
            set: {
              // name / primaryCategoryId は「記事側が正」なので毎回同期する。
              // officialUrl は occurrences 側の冪等規則と同じく null で既存の
              // 確定値を消さない (記事再生成で URL が一時的に落ちても巻き戻さない)
              name: sql`excluded.name`,
              primaryCategoryId: sql`excluded.primary_category_id`,
              officialUrl: sql`coalesce(excluded.official_url, ${events.officialUrl})`,
            },
          })
          .returning({ id: events.id });
        result.eventsUpserted += 1;
        const eventId = eventRow.id;

        const titlePairs = plan.eventTitles.filter((p) => p.eventSlug === eventSlug);
        if (titlePairs.length > 0) {
          await tx
            .insert(eventTitles)
            .values(titlePairs.map((p) => ({ eventId, titleId: p.titleId })))
            .onConflictDoNothing();
          result.eventTitlesUpserted += titlePairs.length;
        }

        const categoryPairs = plan.eventCategories.filter((p) => p.eventSlug === eventSlug);
        if (categoryPairs.length > 0) {
          await tx
            .insert(eventCategories)
            .values(categoryPairs.map((p) => ({ eventId, categoryId: p.categoryId })))
            .onConflictDoNothing();
          result.eventCategoriesUpserted += categoryPairs.length;
        }

        for (const occurrence of plan.occurrences.filter((o) => o.eventSlug === eventSlug)) {
          if (occurrence.action === 'insert') {
            await tx.insert(occurrences).values({
              eventId,
              venueId: occurrence.venueId,
              venueLabel: occurrence.venueLabel,
              slug: occurrence.slug,
              startsOn: occurrence.startsOn,
              endsOn: occurrence.endsOn,
              verified: occurrence.verified,
            });
            result.occurrencesInserted += 1;
          } else {
            await tx
              .update(occurrences)
              .set({
                venueId: occurrence.venueId,
                venueLabel: occurrence.venueLabel,
                startsOn: occurrence.startsOn,
                endsOn: occurrence.endsOn,
                verified: occurrence.verified,
              })
              .where(and(eq(occurrences.eventId, eventId), eq(occurrences.slug, occurrence.slug)));
            result.occurrencesUpdated += 1;
          }
        }
      });
    } catch (error: unknown) {
      result.failures.push({
        eventSlug,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
