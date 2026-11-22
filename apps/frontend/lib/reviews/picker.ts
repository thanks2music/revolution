import 'server-only';

import { z } from 'zod';

import { OccurrenceStatusSchema, type OccurrenceStatus } from '@revolution/schemas/occurrence';
import type { ReviewStatus } from '@revolution/schemas/review';

import { PRIMARY_CATEGORY_EMBED } from '@/lib/event/contracts';
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
/**
 * 名前で探す時に、作品・企画・会場それぞれから拾う件数の上限。超えた分は新しい物 (ID の大きい順) を残す。
 * 短くてよくある言葉だと、合う開催が漏れることがある (言葉を足せば出る)
 */
const MATCH_LIMIT = 50;
/** 開催を引く時に渡す企画の ID の数の上限 (URL の長さを抑える) */
const MAX_EVENT_IDS = 200;
/** 検索の言葉の長さの上限 (7-0 の入力欄の maxLength も使う) */
export const MAX_QUERY_LENGTH = 50;

/** 口コミを書く開催の 1 行に要る列。自分の口コミの一覧 (own-reviews.ts) も同じ列を埋め込む */
export const REVIEW_TARGET_COLUMNS =
  'id, slug, status, starts_on, ends_on, venue_label, venues(name), ' +
  `events!inner(id, name, ${PRIMARY_CATEGORY_EMBED})`;

export const ReviewTargetRowSchema = z.object({
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
export type ReviewTargetRow = z.infer<typeof ReviewTargetRowSchema>;

/**
 * 行を画面の形にする。own (会員のこの開催の口コミ) を渡すと、書けるかは「その口コミを直せるか」になる
 * (提出した口コミは、中止になった開催でも直せる。`authoringMode`)
 */
export function toTarget(
  row: ReviewTargetRow,
  today: string,
  own: { status: ReviewStatus; visitedOn: string | null } | null = null
): ReviewTarget {
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
        own,
      }).kind !== 'blocked',
  };
}

function parseTargets(rows: unknown[]): ReviewTarget[] {
  const today = todayInJst();
  return z
    .array(ReviewTargetRowSchema)
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
// 呼ぶのは会員だけが開ける 7-0 のページ (app/review/page.tsx) だけ。公開の Server Action にしない
// (別名の照合に service role を使うため)
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
      .order('id', { ascending: false })
      .limit(MATCH_LIMIT),
    admin
      ? admin
          .from('title_aliases')
          .select('titles(event_titles(event_id))')
          .ilike('alias', pattern)
          .order('alias')
          .limit(MATCH_LIMIT)
      : noRows,
    supabase
      .from('events')
      .select('id')
      .ilike('name', pattern)
      .order('id', { ascending: false })
      .limit(MATCH_LIMIT),
    supabase
      .from('venues')
      .select('id')
      .ilike('name', pattern)
      .order('id', { ascending: false })
      .limit(MATCH_LIMIT),
    admin
      ? admin
          .from('venue_aliases')
          .select('venue_id')
          .ilike('alias', pattern)
          .order('alias')
          .limit(MATCH_LIMIT)
      : noRows,
    // 会場がマスタに無い開催は、表示名 (venue_label) で探す
    supabase
      .from('occurrence_view')
      .select('id')
      .ilike('venue_label', pattern)
      .order('id', { ascending: false })
      .limit(MATCH_LIMIT),
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
  // 作品 1 つに企画が多く結び付くと ID の一覧が長くなり、URL の長さの上限に当たる。新しい企画を残す
  const boundedEventIds = [...eventIds].sort((a, b) => b - a).slice(0, MAX_EVENT_IDS);
  const venueIds = new Set<number>([
    ...(venues.data ?? []).map(row => row.id as number),
    ...(venueAliases.data ?? []).map(row => row.venue_id as number),
  ]);

  const labelledIds = (labelled.data ?? []).map(row => row.id as number);
  // 利用者の言葉は .or() の文字列に入れない (`,` や `)` で崩れるため)。ID だけを並べる
  const conditions = [
    boundedEventIds.length > 0 && `event_id.in.(${boundedEventIds.join(',')})`,
    venueIds.size > 0 && `venue_id.in.(${[...venueIds].join(',')})`,
    labelledIds.length > 0 && `id.in.(${labelledIds.join(',')})`,
  ].filter(Boolean);
  if (conditions.length === 0) return [];
  const list = (writable: boolean) => {
    const base = supabase
      .from('occurrence_view')
      .select(REVIEW_TARGET_COLUMNS)
      .or(conditions.join(','));
    return (
      writable
        ? base.in('status', WRITABLE_STATUSES)
        : base.not('status', 'in', `(${WRITABLE_STATUSES.join(',')})`)
    )
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(SEARCH_LIMIT);
  };
  // 書ける側の 30 件には、状態は終了でも選べる日が無い開催 (訪問日の範囲外) も入りうる。
  // 件数の上限の中で後ろへ回すだけにし、追加では引かない (検索の言葉を絞れば出る)
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
    .select(REVIEW_TARGET_COLUMNS)
    .in('id', occurrenceIds);
  if (error) throw error;
  const byId = new Map(parseTargets(data ?? []).map(target => [target.occurrenceId, target]));
  return occurrenceIds.flatMap(id => byId.get(id) ?? []);
}
