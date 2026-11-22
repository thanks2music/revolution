import 'server-only';

import { z } from 'zod';

import { OccurrenceStatusSchema, type OccurrenceStatus } from '@revolution/schemas/occurrence';

import { getOccurrenceUrl } from '@/lib/event/event-url';
import { todayInJst } from '@/lib/occurrence/status';
import { authoringMode } from '@/lib/reviews/eligibility';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * 口コミを書く開催を選ぶ (7-0、Figma `93:130`、one-more-time #166)。
 *
 * 読むのは公開のクライアント (RLS が確認済みの開催だけを返す)。書けるかは開催の状態と日付で決める
 * (`authoringMode`。開催中・終了で、選べる訪問日がある開催だけ)。開催前・日程未発表・中止は「まだ書けない」。
 */
export type ReviewTarget = {
  occurrenceId: number;
  eventName: string;
  venueName: string | null;
  status: OccurrenceStatus;
  startsOn: string | null;
  endsOn: string | null;
  occurrencePath: string;
  /** 口コミを書けるか (開催中か終了で、選べる日がある) */
  canWrite: boolean;
};

/** 検索で返す件数の上限 */
const SEARCH_LIMIT = 30;
/** 名前で探す時に、作品・企画・会場それぞれから拾う件数の上限 */
const MATCH_LIMIT = 50;
/** 検索の言葉の長さの上限 */
const MAX_QUERY_LENGTH = 50;

const TARGET_COLUMNS =
  'id, slug, status, starts_on, ends_on, venue_label, venues(name), ' +
  'events!inner(id, name, primaryCategory:categories!primary_category_id(slug))';

const TargetRowSchema = z.object({
  id: z.number(),
  slug: z.string(),
  status: OccurrenceStatusSchema,
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
  venue_label: z.string().nullable(),
  venues: z.object({ name: z.string() }).nullable(),
  events: z.object({
    id: z.number(),
    name: z.string(),
    primaryCategory: z.object({ slug: z.string() }),
  }),
});

function toTarget(row: z.infer<typeof TargetRowSchema>, today: string): ReviewTarget {
  return {
    occurrenceId: row.id,
    eventName: row.events.name,
    venueName: row.venues?.name ?? row.venue_label,
    status: row.status,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    occurrencePath: getOccurrenceUrl(
      { id: row.events.id, primaryCategory: row.events.primaryCategory },
      row.slug
    ),
    canWrite:
      authoringMode({
        occurrenceStatus: row.status,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        today,
        own: null,
      }).kind !== 'blocked',
  };
}

function parseTargets(rows: unknown[]): ReviewTarget[] {
  const today = todayInJst();
  return z
    .array(TargetRowSchema)
    .parse(rows)
    .map(row => toTarget(row, today));
}

/**
 * LIKE の特別な文字を、そのままの文字として探す形にする。PostgREST は `*` も `%` として扱うので、
 * `*` も除く (エスケープできないので空白に置き換える)
 */
export function toLikePattern(query: string): string {
  return `%${query.replace(/\*/g, ' ').replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

/** 検索の言葉を整える (前後の空白を除き、長すぎる物は切る)。空なら null */
export function normalizeQuery(query: string | undefined | null): string | null {
  const trimmed = (query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  return trimmed === '' ? null : trimmed;
}

const TitleLinksSchema = z.object({
  event_titles: z.array(z.object({ event_id: z.number() })).nullable(),
});
const AliasLinksSchema = z.object({
  titles: z.union([TitleLinksSchema, z.array(TitleLinksSchema)]).nullable(),
});

/** 書ける状態の開催 (日付の範囲は authoringMode が最後に確かめる) */
const WRITABLE_STATUSES = ['ongoing', 'ended'] as const;

/**
 * 作品名・企画名・会場名 (別名を含む) で開催を探す。書ける開催と、まだ書けない開催 (開催前など) を
 * 別々に引き、書ける開催を先に出す (開催前の開催が多くても、書ける開催が押し出されないように)。
 * どちらも開始日の新しい順
 */
export async function searchReviewTargets(query: string): Promise<ReviewTarget[]> {
  if (!hasPublicSupabaseCredentials()) return [];
  const supabase = createPublicClient();
  const pattern = toLikePattern(query);
  // 別名の表は公開していない (取り込みが使う辞書)。照合だけを service role で行い、出すのは開催だけ。
  // 鍵の無い環境では別名を使わない
  const admin = createAdminClient();
  const noRows = Promise.resolve({ data: [], error: null });

  const [titles, titleAliases, events, venues, venueAliases, labelled] = await Promise.all([
    supabase
      .from('titles')
      .select('event_titles(event_id)')
      .ilike('name', pattern)
      .limit(MATCH_LIMIT),
    admin
      ? admin
          .from('title_aliases')
          .select('titles(event_titles(event_id))')
          .ilike('alias', pattern)
          .limit(MATCH_LIMIT)
      : noRows,
    supabase.from('events').select('id').ilike('name', pattern).limit(MATCH_LIMIT),
    supabase.from('venues').select('id').ilike('name', pattern).limit(MATCH_LIMIT),
    admin
      ? admin.from('venue_aliases').select('venue_id').ilike('alias', pattern).limit(MATCH_LIMIT)
      : noRows,
    // 会場がマスタに無い開催は、表示名 (venue_label) で探す
    supabase.from('occurrence_view').select('id').ilike('venue_label', pattern).limit(MATCH_LIMIT),
  ]);
  for (const result of [titles, titleAliases, events, venues, venueAliases, labelled]) {
    if (result.error) throw result.error;
  }

  const eventIds = new Set<number>((events.data ?? []).map(row => row.id as number));
  const titleRows = [
    ...TitleLinksSchema.array().parse(titles.data ?? []),
    ...AliasLinksSchema.array()
      .parse(titleAliases.data ?? [])
      .flatMap(row => (Array.isArray(row.titles) ? row.titles : row.titles ? [row.titles] : [])),
  ];
  for (const title of titleRows) {
    for (const link of title.event_titles ?? []) eventIds.add(link.event_id);
  }
  const venueIds = new Set<number>([
    ...(venues.data ?? []).map(row => row.id as number),
    ...(venueAliases.data ?? []).map(row => row.venue_id as number),
  ]);

  const labelledIds = (labelled.data ?? []).map(row => row.id as number);
  // 利用者の言葉は .or() の文字列に入れない (`,` や `)` で崩れるため)。ID だけを並べる
  const conditions = [
    eventIds.size > 0 && `event_id.in.(${[...eventIds].join(',')})`,
    venueIds.size > 0 && `venue_id.in.(${[...venueIds].join(',')})`,
    labelledIds.length > 0 && `id.in.(${labelledIds.join(',')})`,
  ].filter(Boolean);
  if (conditions.length === 0) return [];
  const list = (writable: boolean) => {
    const query = supabase.from('occurrence_view').select(TARGET_COLUMNS).or(conditions.join(','));
    return (
      writable
        ? query.in('status', WRITABLE_STATUSES)
        : query.not('status', 'in', `(${WRITABLE_STATUSES.join(',')})`)
    )
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(SEARCH_LIMIT);
  };
  const [writable, notYet] = await Promise.all([list(true), list(false)]);
  if (writable.error) throw writable.error;
  if (notYet.error) throw notYet.error;
  const targets = parseTargets([...(writable.data ?? []), ...(notYet.data ?? [])]);
  // 状態は書ける形でも、選べる日が無い開催は後ろへ (並びは保ったまま)
  return [
    ...targets.filter(target => target.canWrite),
    ...targets.filter(target => !target.canWrite),
  ];
}

/** 開催の ID から引く (最近見た開催)。渡した順に並べ、見つからない開催は除く */
export async function getReviewTargets(occurrenceIds: number[]): Promise<ReviewTarget[]> {
  if (!hasPublicSupabaseCredentials() || occurrenceIds.length === 0) return [];
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('occurrence_view')
    .select(TARGET_COLUMNS)
    .in('id', occurrenceIds);
  if (error) throw error;
  const byId = new Map(parseTargets(data ?? []).map(target => [target.occurrenceId, target]));
  return occurrenceIds.flatMap(id => byId.get(id) ?? []);
}
