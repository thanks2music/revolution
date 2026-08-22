import { VENUE_SLUG_REGEX } from '@revolution/schemas/venue';
import { cache } from 'react';
import { z } from 'zod';

import { fetchAllRows } from '@/lib/supabase/paginate';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';
import {
  toVenueOccurrences,
  VENUE_DETAIL_COLUMNS,
  VENUE_OCCURRENCE_COLUMNS,
  VenueDetailSchema,
  type VenueDetail,
} from '@/lib/venue/contracts';
import {
  groupVenueOccurrencesByStatus,
  type VenueOccurrenceGroup,
} from '@/lib/venue/grouping';

/**
 * 会場 (venue) の読み取り。
 *
 * ## 会場ページは「その会場の全開催」(URL 設計 §7)
 *
 * 一覧に載る開催の canonical は本拠地 (`/events/{id}/{occurrence-slug}`) を指す。
 * 開催の絞り込みキーは **`occurrences.venue_id`** — `occurrences.slug` は
 * 「企画内で会場を表すハンドル」であり、値が `venues.slug` と一致する運用
 * (§7 案 B) でも一意性のスコープが違うため使わない。
 *
 * ## 見える範囲
 *
 * anon 接続なので開催は `verified = true` のみ (`lib/occurrence/queries.ts`)。
 * `venue_aliases` は anon に非公開 (RLS `USING (false)`) のため触らない
 * (`lib/venue/contracts.ts` の docstring)。
 */

export type VenueDetailData = {
  venue: VenueDetail;
  /** この会場の全開催。状態別グループ (表示順)。開催 0 件なら空配列。 */
  groups: VenueOccurrenceGroup[];
};

/**
 * 会場ページの**対象集合の定義をここ 1 箇所に閉じる** (`queryTitleRows` と同じ形、
 * 2026-08-21 Codex レビュー指摘の再発防止)。
 *
 * `listVenueParams` (静的生成の対象) と `listVenueDetails` (`/venues` 一覧に
 * 載せる対象) は**同じ集合でなければならない** — 一覧に載っているのにページが
 * 生成されていなければ 404 リンクになり、逆なら到達不能ページになる。
 *
 * 取得する列だけを引数で変え、**絞り込み条件と並び順は共有する**。
 * 並び順は `name` → `slug` の全順序 (range ページングの境界で行が重複・欠落
 * しないように。slug は UNIQUE なのでこれで全順序になる)。
 */
async function queryVenueRows(args: { label: string; columns: string }): Promise<unknown[]> {
  const supabase = createPublicClient();

  // 全件列挙なので単発 select にしない (理由は `lib/supabase/paginate.ts`)。
  return fetchAllRows({
    label: args.label,
    fetchPage: (from, to) =>
      supabase
        .from('venues')
        .select(args.columns)
        // 表示順を DB 任せにしない。slug は UNIQUE なのでタイブレークに使える。
        .order('name', { ascending: true })
        .order('slug', { ascending: true })
        .range(from, to),
  });
}

/**
 * `generateStaticParams` 用。venues マスタの全 slug を列挙する。
 *
 * 開催 0 件の会場も生成対象に含める (会場ページは空状態を通常状態として描く。
 * 作品ハブと同じ方針 — 集合を絞ると一覧・生成対象・詳細の 404 ゼロが崩れる)。
 * 資格情報が無いビルドで 0 件を返す扱いと、資格情報があるのに失敗したら
 * throw する扱いは `listTitleParams` と同じ。
 */
export async function listVenueParams(): Promise<{ slug: string }[]> {
  if (!hasPublicSupabaseCredentials()) {
    // 黙って 0 件にしない。ビルドログに理由を残す。
    console.warn(
      '[venue] Supabase の公開接続情報が無いため、会場ページの静的生成をスキップしました ' +
        '(資格情報を持たないビルドでは想定どおり)。ページは実行時にオンデマンド生成されます。',
    );
    return [];
  }

  const rows = await queryVenueRows({ label: 'venue params', columns: 'slug' });
  return z.array(z.object({ slug: z.string() })).parse(rows);
}

/** `/venues` 一覧カード 1 枚ぶん。会場マスタの行 + 開催数 (Claude Design v6 #15)。 */
export type VenueListItem = VenueDetail & {
  /**
   * この会場の公開済み開催の総数。**0 のときは表示側で行を出さない**
   * (「データ源が無い項目は置かない」の既存規律に合わせる)。
   */
  occurrenceCount: number;
};

/**
 * `/venues` 一覧ページ用。venues マスタの全行を name 順で列挙し、開催数を添える。
 *
 * 対象集合は `listVenueParams` と共有する (`queryVenueRows`)。
 * = 一覧に載る会場は必ずページを持つ (404 リンクにならない)。
 *
 * ⚠️ **開催数は「対象集合」に影響させない。** 開催 0 件の会場も一覧に載せ、ページも
 *    生成する (会場ページは空状態を通常状態として描く)。集計は表示上の装飾であり、
 *    `queryVenueRows` の絞り込み条件には一切触らない — ここを混ぜると
 *    「一覧・生成対象・詳細の 404 ゼロ」という #333 で作り込んだ不変条件が壊れる。
 *
 * ## v6 で開催数が付いた経緯 (2026-08-22)
 *
 * PR #333 の時点では「MVP では開催数を置かない」判断だった。v6 #15 が
 * `▲ 要クエリ拡張` として要求し、**BOSS がその案を採用して当時の判断を意図的に
 * 上書きした**。粒度は総数のみ (状態別内訳は出さない、2026-08-22 BOSS 確定)。
 */
export async function listVenueDetails(): Promise<VenueListItem[]> {
  if (!hasPublicSupabaseCredentials()) {
    return [];
  }

  const [rows, counts] = await Promise.all([
    queryVenueRows({ label: 'venue details', columns: VENUE_DETAIL_COLUMNS }),
    countOccurrencesByVenue(),
  ]);

  return z
    .array(VenueDetailSchema)
    .parse(rows)
    .map((venue) => ({ ...venue, occurrenceCount: counts.get(venue.id) ?? 0 }));
}

/**
 * 会場ごとの開催数。`occurrence_view` を 1 周して JS で数える。
 *
 * ## DB 集約は使えない (2026-08-22 実測)
 *
 * PostgREST の集約関数はこのプロジェクトの Supabase では無効
 * (`400 PGRST123 "Use of aggregate functions is not allowed"`)。DB 側で数えるには
 * view / RPC を足す migration が要るため、MVP 規模では JS 集計とする
 * (`countOccurrencesByEvent` と同じ判断)。
 *
 * ## `venue_id is null` の行は数えない
 *
 * 会場マスタを持たない開催 (`venue_label` だけの開催) が**実データに存在する**
 * (2026-08-22 実測 1 件)。どの会場にも属さないので、どの会場の件数にも足さない。
 *
 * ⚠️ 全件走査なので `fetchAllRows` で page 化し、並びは基底テーブルの `id`
 *    (`occurrence_view.id` は開催 id で UNIQUE = 全順序)。
 */
async function countOccurrencesByVenue(): Promise<Map<number, number>> {
  const supabase = createPublicClient();

  const rows = await fetchAllRows({
    label: 'occurrence counts by venue',
    fetchPage: (from, to) =>
      supabase
        .from('occurrence_view')
        .select('venueId:venue_id')
        .order('id', { ascending: true })
        .range(from, to),
  });

  const parsed = z.array(z.object({ venueId: z.number().nullable() })).parse(rows);

  const byVenue = new Map<number, number>();
  for (const row of parsed) {
    if (row.venueId === null) continue;
    byVenue.set(row.venueId, (byVenue.get(row.venueId) ?? 0) + 1);
  }
  return byVenue;
}

/**
 * 会場ページ 1 件分の DB 由来データ。見つからなければ null。
 *
 * `React.cache()` でリクエスト内メモ化する (`generateMetadata` とページ本体の
 * 両方から同じ引数で呼ばれるため。`getTitleHubData` と同じ理由)。
 *
 * slug は URL 由来の文字列なので、**正準形 (`VENUE_SLUG_REGEX`) でなければ
 * 問い合わせずに** null を返す (`/venues/FOO` のような表記ゆれを 404 にして
 * 重複コンテンツを作らず、DB へ無駄に投げない)。
 */
export const getVenueDetail = cache(async function getVenueDetail(
  slugRaw: string,
): Promise<VenueDetailData | null> {
  if (!VENUE_SLUG_REGEX.test(slugRaw)) return null;

  const supabase = createPublicClient();

  const venueResult = await supabase
    .from('venues')
    .select(VENUE_DETAIL_COLUMNS)
    .eq('slug', slugRaw)
    .maybeSingle();

  // ⚠️ error を見ないと「クエリが落ちた」が「該当 0 件」と区別できない
  //    (`getTitleHubData` と同じ防御)。
  if (venueResult.error) {
    throw new Error(`failed to load venue: ${venueResult.error.message}`);
  }
  if (!venueResult.data) return null;

  const venue = VenueDetailSchema.parse(venueResult.data);

  // ⚠️ **1 会場ぶんの絞り込みでも全件ページングする** (単発 select にしない)。
  //    「1 会場の全開催」は企画をまたいで積み上がり続ける集合で、`getEventDetail`
  //    の「1 企画の開催 = 会場数」より桁が大きい。`db.max_rows` (Supabase 既定
  //    1000) は**エラーにせず黙って打ち切る**ため、単発 select だと開催が静かに
  //    欠落する (`getTitleHubData` と同じ判断、2026-08-21 Codex レビュー指摘)。
  //
  //    企画は `events(id, name)` の埋め込みで同時に取る (view でも PostgREST の
  //    埋め込みは効く、`lib/occurrence/queries.ts` の実測)。2 段クエリにしないので
  //    「企画 ID が出揃うのを待つ」分岐も不要。
  const occurrenceRows = await fetchAllRows({
    label: `venue occurrences (${slugRaw})`,
    fetchPage: (from, to) =>
      supabase
        .from('occurrence_view')
        .select(VENUE_OCCURRENCE_COLUMNS)
        .eq('venue_id', venue.id)
        // ⚠️ ページ境界の安定順序は**基底テーブルの列**で作る。埋め込み先
        //    (`events.name`) の order は全順序を保証せず、range ページングで
        //    行の重複・欠落を招き得る。表示順は `groupVenueOccurrencesByStatus`
        //    (状態 → 日付 → 企画名) で作り直す。
        .order('starts_on', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to),
  });

  return {
    venue,
    groups: groupVenueOccurrencesByStatus(toVenueOccurrences(occurrenceRows)),
  };
});
