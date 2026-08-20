import { TITLE_SLUG_REGEX } from '@revolution/schemas/title';
import { cache } from 'react';
import { z } from 'zod';

import { OCCURRENCE_COLUMNS, toOccurrences } from '@/lib/occurrence/queries';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';
import {
  parseEmbeddedTitleEvents,
  TITLE_DETAIL_COLUMNS,
  TITLE_EVENT_COLUMNS,
  TitleDetailSchema,
  type TitleDetail,
} from '@/lib/title/contracts';
import { buildTitleEventGroups, type TitleEventGroup } from '@/lib/title/grouping';
import type { TitleEventSlugPair } from '@/lib/title/article-links';

/**
 * 作品 (title) の読み取り。
 *
 * ## 作品ハブは「集約ビュー」(URL 設計 §7)
 *
 * title はコラボ (M:N) のため正準の所有者になれず、一覧に載る item の
 * canonical は本拠地 (`/events/{id}/…` / `/articles/{ULID}`) を指す。
 * 本モジュールはその集約に要る DB 読みだけを担い、記事 (fs 由来) との
 * 突き合わせは `lib/title/article-links.ts` (Layer 1) に置く。
 *
 * ## 見える範囲
 *
 * anon 接続なので開催は `verified = true` のみ (`lib/occurrence/queries.ts`)。
 * `title_aliases` は anon に非公開 (RLS `USING (false)`、2026-08-02 BOSS 確定)
 * のため**このモジュールから触らない**。ゆれの解決は取り込み済みの
 * `event_titles` を経由する (`lib/title/article-links.ts` の docstring)。
 */

export type TitleHubData = {
  title: TitleDetail;
  /** この作品の企画 (公開済み開催を 1 件以上持つもの) + その開催。表示順。 */
  eventGroups: TitleEventGroup[];
  /**
   * この作品の**全**企画の `events.slug` (開催 0 件の企画も含む)。
   * 記事との紐付けキー。記事の公開は occurrence の verified とは独立なので、
   * 開催が未公開でも記事は作品ハブに出してよい。
   */
  eventSlugs: Set<string>;
};

/**
 * `generateStaticParams` 用。titles マスタの全 slug を列挙する。
 *
 * 企画 0 件の作品も生成対象に含める (ハブは空状態を通常状態として描く。
 * v5 デザインの方針)。資格情報が無いビルドで 0 件を返す扱いと、資格情報が
 * あるのに失敗したら throw する扱いは `listOccurrenceParams` と同じ。
 */
export async function listTitleParams(): Promise<{ slug: string }[]> {
  if (!hasPublicSupabaseCredentials()) {
    // 黙って 0 件にしない。ビルドログに理由を残す。
    console.warn(
      '[title] Supabase の公開接続情報が無いため、作品ハブの静的生成をスキップしました ' +
        '(資格情報を持たないビルドでは想定どおり)。ページは実行時にオンデマンド生成されます。',
    );
    return [];
  }

  const supabase = createPublicClient();

  // 全件列挙なので単発 select にしない (理由は `lib/supabase/paginate.ts`)。
  const rows = await fetchAllRows({
    label: 'title params',
    fetchPage: (from, to) =>
      supabase.from('titles').select('slug').order('slug', { ascending: true }).range(from, to),
  });

  return z.array(z.object({ slug: z.string() })).parse(rows);
}

/**
 * `/titles/{slug}/articles/{category}` の `generateStaticParams` 用。
 * `event_titles` を (作品 slug, 企画 slug) の対に平らげて全件列挙する。
 */
export async function listTitleEventSlugPairs(): Promise<TitleEventSlugPair[]> {
  if (!hasPublicSupabaseCredentials()) {
    return [];
  }

  const supabase = createPublicClient();

  const rows = await fetchAllRows({
    label: 'title-event pairs',
    fetchPage: (from, to) =>
      supabase
        .from('event_titles')
        .select('titles!inner(slug), events!inner(slug)')
        // ページング (range) の境界で行が重複・欠落しないよう全順序で並べる
        // (event_id 単独は複数作品コラボで同値が並ぶ)。
        .order('event_id', { ascending: true })
        .order('title_id', { ascending: true })
        .range(from, to),
  });

  return z
    .array(
      z.object({
        titles: z.object({ slug: z.string() }).nullable(),
        events: z.object({ slug: z.string() }).nullable(),
      }),
    )
    .parse(rows)
    .flatMap((row) =>
      row.titles && row.events ? [{ titleSlug: row.titles.slug, eventSlug: row.events.slug }] : [],
    );
}

/**
 * 作品ハブ 1 件分の DB 由来データ。見つからなければ null。
 *
 * `React.cache()` でリクエスト内メモ化する (`generateMetadata` とページ本体の
 * 両方から同じ引数で呼ばれるため。`getEventDetail` と同じ理由)。
 *
 * slug は URL 由来の文字列なので、**正準形 (`TITLE_SLUG_REGEX`) でなければ
 * 問い合わせずに** null を返す (`parseCanonicalId` と同じ発想: `/titles/FOO` の
 * ような表記ゆれを 404 にして重複コンテンツを作らず、DB へ無駄に投げない)。
 */
export const getTitleHubData = cache(async function getTitleHubData(
  slugRaw: string,
): Promise<TitleHubData | null> {
  if (!TITLE_SLUG_REGEX.test(slugRaw)) return null;

  const supabase = createPublicClient();

  // ⚠️ builder を変数に置かず `Promise.all` の引数として直接構築する
  //    (lazy な PromiseLike のため。理由は `getOccurrenceDetail` のコメント)。
  const [titleResult, eventTitleResult] = await Promise.all([
    supabase.from('titles').select(TITLE_DETAIL_COLUMNS).eq('slug', slugRaw).maybeSingle(),
    supabase
      .from('event_titles')
      .select(TITLE_EVENT_COLUMNS)
      .eq('titles.slug', slugRaw)
      // 表示順を DB 任せにしない。後段の並び替え (状態 → 終了が新しい順) の
      // 同順位タイブレークとして名前順が残る。
      .order('name', { ascending: true, referencedTable: 'events' }),
  ]);

  // ⚠️ error を見ないと「クエリが落ちた」が「該当 0 件」と区別できない
  //    (`getEventDetail` と同じ防御)。
  for (const [label, result] of [
    ['title', titleResult],
    ['events', eventTitleResult],
  ] as const) {
    if (result.error) {
      throw new Error(`failed to load ${label}: ${result.error.message}`);
    }
  }

  if (!titleResult.data) return null;

  const events = parseEmbeddedTitleEvents(eventTitleResult.data);

  // 開催は企画 ID が出揃ってからでないと引けない (2 段目)。企画 0 件なら
  // クエリ自体を省く。
  let occurrences: ReturnType<typeof toOccurrences> = [];
  if (events.length > 0) {
    const occurrenceResult = await supabase
      .from('occurrence_view')
      .select(OCCURRENCE_COLUMNS)
      .in(
        'event_id',
        events.map((event) => event.id),
      )
      // 明示的に並べる。日程未発表 (starts_on is null) は末尾へ
      // (`getOccurrenceDetail` と同じ)。
      .order('starts_on', { ascending: true, nullsFirst: false });

    if (occurrenceResult.error) {
      throw new Error(`failed to load occurrences: ${occurrenceResult.error.message}`);
    }
    occurrences = toOccurrences(occurrenceResult.data);
  }

  return {
    title: TitleDetailSchema.parse(titleResult.data),
    eventGroups: buildTitleEventGroups(events, occurrences),
    eventSlugs: new Set(events.map((event) => event.slug)),
  };
});
