import * as Sentry from '@sentry/nextjs';
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
 * 作品ハブの**対象集合の定義をここ 1 箇所に閉じる** (2026-08-21 Codex レビュー指摘)。
 *
 * `listTitleParams` (静的生成の対象) と `listTitleDetails` (`/titles` 一覧に
 * 載せる対象) は**同じ集合でなければならない** — 一覧に載っているのにページが
 * 生成されていなければ 404 リンクになり、逆なら到達不能ページになる。
 *
 * 別クエリとして 2 箇所に書くと、将来どちらかに「kind で絞る」「非公開フラグを
 * 除く」等の条件が入ったときに**片方だけ変わって回帰する**。`listEventSummaries`
 * が `listEventParams` を呼んで集合を一本化しているのと同じ形に揃えた。
 *
 * 取得する列だけを引数で変え、**絞り込み条件と並び順は共有する**。
 * 並び順は `name` → `slug` の全順序 (range ページングの境界で行が重複・欠落
 * しないように。slug は UNIQUE なのでこれで全順序になる)。
 */
async function queryTitleRows(args: { label: string; columns: string }): Promise<unknown[]> {
  const supabase = createPublicClient();

  // 全件列挙なので単発 select にしない (理由は `lib/supabase/paginate.ts`)。
  return fetchAllRows({
    label: args.label,
    fetchPage: (from, to) =>
      supabase
        .from('titles')
        .select(args.columns)
        // 表示順を DB 任せにしない。slug は UNIQUE なのでタイブレークに使える。
        .order('name', { ascending: true })
        .order('slug', { ascending: true })
        .range(from, to),
  });
}

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

  const rows = await queryTitleRows({ label: 'title params', columns: 'slug' });
  return z.array(z.object({ slug: z.string() })).parse(rows);
}

/**
 * `/titles` 一覧ページ用。titles マスタの全行を name 順で列挙する。
 *
 * 対象集合は `listTitleParams` と共有する (`queryTitleRows`)。
 * = 一覧に載る作品は必ずページを持つ (404 リンクにならない)。
 */
export async function listTitleDetails(): Promise<TitleDetail[]> {
  if (!hasPublicSupabaseCredentials()) {
    return [];
  }

  const rows = await queryTitleRows({
    label: 'title details',
    columns: TITLE_DETAIL_COLUMNS,
  });
  return z.array(TitleDetailSchema).parse(rows);
}

/**
 * `/titles/{slug}/articles/{category}` の `generateStaticParams` と記事ページの
 * 作品チップリンク化に使う。`event_titles` を (作品, 企画 slug) の対に平らげて
 * 全件列挙する。
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
        .select('titles!inner(slug, name), events!inner(slug)')
        // ページング (range) の境界で行が重複・欠落しないよう全順序で並べる
        // (event_id 単独は複数作品コラボで同値が並ぶ)。
        .order('event_id', { ascending: true })
        .order('title_id', { ascending: true })
        .range(from, to),
  });

  return z
    .array(
      z.object({
        titles: z.object({ slug: z.string(), name: z.string() }).nullable(),
        events: z.object({ slug: z.string() }).nullable(),
      }),
    )
    .parse(rows)
    .flatMap((row) =>
      row.titles && row.events
        ? [{ titleSlug: row.titles.slug, titleName: row.titles.name, eventSlug: row.events.slug }]
        : [],
    );
}

/**
 * 記事ページの作品チップリンク化に使う入力 (titles 全件 + 対応表)。
 *
 * `React.cache()` でリクエスト内メモ化する (記事ページは 1 render で 1 回だけ
 * 呼ぶが、`generateMetadata` から呼ぶようになったときに二重問い合わせしない)。
 *
 * ## 🔴 ここだけは throw しない (記事を DB 障害の人質にしない)
 *
 * 記事本文は `article-index.json` (fs) 由来で **DB とは独立**している。
 * 作品チップのリンクは装飾であって記事の本体ではないので、DB が落ちている
 * ときは**リンクを諦めて記事を出す**。throw すると Supabase の一時障害で
 * **記事ページ全部がビルドできなくなる**。
 *
 * これは `app/sitemap.ts` が「種別ごとに独立して劣化させる」で直したのと
 * 同じ結合 (記事の描画が DB の可用性に巻き込まれる) を作らないための判断。
 * **一方 `/titles` / `/events` の一覧ページは throw させる** — そこでは
 * DB の中身がページの本体であり、空リストを出すと「作品が 0 件」という
 * 嘘の成功になるため (`listOccurrenceParams` の docstring と同じ立場)。
 */
export const getTitleLinkSources = cache(async function getTitleLinkSources(): Promise<{
  titles: TitleDetail[];
  pairs: TitleEventSlugPair[];
}> {
  try {
    const [titles, pairs] = await Promise.all([listTitleDetails(), listTitleEventSlugPairs()]);
    return { titles, pairs };
  } catch (error) {
    // 黙って空にしない。チップのリンクが消えたことに気づけるようにする。
    // level は warning 止まり (記事は出ており「起きて対応すべき」ではない)。
    console.warn('[title] 作品リンクの解決に失敗しました。チップはテキストで描画します。', error);
    Sentry.captureMessage('作品チップのリンク解決に失敗した', {
      level: 'warning',
      fingerprint: ['article-title-links-unavailable'],
    });
    return { titles: [], pairs: [] };
  }
});

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

  const titleResult = await supabase
    .from('titles')
    .select(TITLE_DETAIL_COLUMNS)
    .eq('slug', slugRaw)
    .maybeSingle();

  // ⚠️ error を見ないと「クエリが落ちた」が「該当 0 件」と区別できない
  //    (`getEventDetail` と同じ防御)。
  if (titleResult.error) {
    throw new Error(`failed to load title: ${titleResult.error.message}`);
  }
  if (!titleResult.data) return null;

  // ⚠️ **1 作品ぶんの絞り込みでも全件ページングする** (単発 select にしない)。
  //    `getEventDetail` は「1 企画の開催」= 会場数なので単発で足りるが、ここは
  //    「1 作品の全企画」と「その全開催」であり桁が 1〜2 つ大きい (企画 100 件 ×
  //    会場 10 で 1000 行に達する)。`db.max_rows` (Supabase 既定 1000) は
  //    **エラーにせず黙って打ち切る**ため、単発 select だと作品ハブの企画・開催と
  //    記事紐付け用の `eventSlugs` が静かに欠落する。
  //
  //    しかも `/titles/{slug}/articles/{category}` の `generateStaticParams` は
  //    `listTitleEventSlugPairs()` で**全件**を読むので、打ち切りが起きると
  //    「静的生成されたのにページ本体は該当 0 件で notFound」という実装内部の
  //    不一致になる (2026-08-21 Codex レビュー指摘)。
  const eventTitleRows = await fetchAllRows({
    label: `title events (${slugRaw})`,
    fetchPage: (from, to) =>
      supabase
        .from('event_titles')
        .select(TITLE_EVENT_COLUMNS)
        .eq('titles.slug', slugRaw)
        // ⚠️ ページ境界の安定順序は**基底テーブルの列**で作る。埋め込み先
        //    (`events.name`) の order は複合主キーの全順序を保証しないため、
        //    range ページングでは行の重複・欠落を招き得る。
        //    表示順は下の `sortedEvents` (name 順) で作り直す。
        .order('event_id', { ascending: true })
        .order('title_id', { ascending: true })
        .range(from, to),
  });

  const events = parseEmbeddedTitleEvents(eventTitleRows);
  // 表示順を DB 任せにしない (取得順は event_id なので名前順へ並べ直す)。
  // 後段 `buildTitleEventGroups` の並び替え (状態 → 終了が新しい順) の
  // 同順位タイブレークとして名前順が残る。
  const sortedEvents = [...events].sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  // 開催は企画 ID が出揃ってからでないと引けない (2 段目)。企画 0 件なら
  // クエリ自体を省く。
  let occurrences: ReturnType<typeof toOccurrences> = [];
  if (sortedEvents.length > 0) {
    const eventIds = sortedEvents.map((event) => event.id);
    const occurrenceRows = await fetchAllRows({
      label: `title occurrences (${slugRaw})`,
      fetchPage: (from, to) =>
        supabase
          .from('occurrence_view')
          .select(OCCURRENCE_COLUMNS)
          .in('event_id', eventIds)
          // 明示的に並べる。日程未発表 (starts_on is null) は末尾へ
          // (`getOccurrenceDetail` と同じ)。`id` は range ページングの
          // タイブレーク (starts_on だけでは同日が同順位になる)。
          .order('starts_on', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to),
    });
    occurrences = toOccurrences(occurrenceRows);
  }

  return {
    title: TitleDetailSchema.parse(titleResult.data),
    eventGroups: buildTitleEventGroups(sortedEvents, occurrences),
    eventSlugs: new Set(sortedEvents.map((event) => event.slug)),
  };
});
