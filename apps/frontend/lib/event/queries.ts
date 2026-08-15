import * as Sentry from '@sentry/nextjs';
import { cache } from 'react';
import { z } from 'zod';

import {
  EVENT_COLUMNS,
  EVENT_TITLES_COLUMNS,
  EventSchema,
  EventSummarySchema,
  type EventSummary,
  parseEmbeddedTitles,
  type Title,
} from '@/lib/event/contracts';
import {
  listOccurrenceParams,
  OCCURRENCE_COLUMNS,
  type Occurrence,
  toOccurrences,
} from '@/lib/occurrence/queries';
import { parseCanonicalId } from '@/lib/route-params';
import { createPublicClient } from '@/lib/supabase/public';

/**
 * 企画 (event) の読み取り。
 *
 * ## occurrence 側から再利用しているもの
 *
 * `OCCURRENCE_COLUMNS` / `toOccurrences` (zod parse + 会場名の解決) は開催詳細
 * ページと共有する。**列・契約・会場名の解決規則を 2 箇所に持たない**ことが
 * 目的で、片方だけ列を足したときに zod と select がずれるのを防ぐ。
 *
 * 依存の向きは 企画 → 開催。企画ページは開催の一覧を出す画面なので自然な向き。
 *
 * ## S2 の時点で作らないもの
 *
 * デザインは 6 ブロックを要求するが、**3 つはデータ源が存在しない** (2026-08-14 実測):
 *
 * | ブロック | 状況 |
 * |---|---|
 * | 評価サマリ (平均 / 件数 / 分布) | `reviews` 0 件。**S4** の範囲 |
 * | 全会場共通情報タブ | **`event_attributes` テーブルが存在しない**。private な `.jarvis/product/mvp-definition.md` §A-3-a が migration 必須項目として挙げているが未作成 |
 * | この企画の記事 | `article-index.json` に企画を特定する項目が無い (`event_slug` も `event_id` も持たない)。紐付けは canonicalKey 再設計を伴う **S3** の範囲 |
 *
 * データ源の形が決まる前に空状態の器や feature flag を置くと、デザイン確定時に
 * 捨てるコードになる (YAGNI)。依存が揃った時点で足す。
 */

export type EventPageData = {
  event: z.infer<typeof EventSchema>;
  titles: Title[];
  /** この企画のすべての開催 (会場名を解決済み)。グルーピングは表示側で行う。 */
  occurrences: Occurrence[];
  /** 同じ作品に紐づく他の企画 (自分を除く)。 */
  relatedEvents: EventSummary[];
};

/**
 * `generateStaticParams` 用。開催を 1 件以上持つ企画の ID を列挙する。
 *
 * ## 開催の列挙から導出する
 *
 * 「開催を 1 件以上持つ企画」は **`listOccurrenceParams()` の結果を dedupe した
 * もの**そのもの。独立したクエリを持つと、同じ `occurrence_view` の全件走査が
 * 2 周するうえ、**「静的生成対象の企画」という 1 つの定義が 2 箇所に存在**して
 * 片方だけ条件を変えると `/events/{id}` と `/events/{id}/{slug}` の集合がずれる。
 *
 * 資格情報が無いビルドで 0 件を返す扱い、`db.max_rows` を跨ぐページング、
 * 失敗時の throw もすべて `listOccurrenceParams` に一本化される。
 */
export async function listEventParams(): Promise<{ id: string }[]> {
  const occurrences = await listOccurrenceParams();
  // Set は挿入順を保つので、列挙側の order がそのまま残る
  // (ビルドごとにパス順が変わらない)。
  return [...new Set(occurrences.map((row) => row.id))].map((id) => ({ id }));
}

/**
 * 企画詳細 1 件 + 表示に要る周辺データ。見つからなければ null。
 *
 * `React.cache()` でリクエスト内メモ化する (`generateMetadata` とページ本体の
 * 両方から同じ引数で呼ばれるため。理由は `lib/occurrence/queries.ts` の
 * `getOccurrenceDetail` と同じ)。
 */
export const getEventDetail = cache(async function getEventDetail(
  eventIdRaw: string,
): Promise<EventPageData | null> {
  // 表記ゆれ (`2.0` / `0x2` / `02` …) を 404 にする。理由は `lib/route-params.ts`。
  const eventId = parseCanonicalId(eventIdRaw);
  if (eventId === null) return null;

  const supabase = createPublicClient();

  // ⚠️ builder を変数に置かず `Promise.all` の引数として直接構築する
  //    (lazy な PromiseLike のため。理由は `getOccurrenceDetail` のコメント)。
  const [eventResult, titleResult, occurrenceResult] = await Promise.all([
    supabase.from('events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle(),
    supabase.from('event_titles').select(EVENT_TITLES_COLUMNS).eq('event_id', eventId),
    supabase.from('occurrence_view').select(OCCURRENCE_COLUMNS).eq('event_id', eventId),
  ]);

  // ⚠️ error を見ないと「クエリが落ちた」が「該当 0 件」と区別できず、
  //    実在する開催が黙って消える。PR #302 で同じ穴を踏んでいる。
  for (const [label, result] of [
    ['event', eventResult],
    ['titles', titleResult],
    ['occurrences', occurrenceResult],
  ] as const) {
    if (result.error) {
      throw new Error(`failed to load ${label}: ${result.error.message}`);
    }
  }

  if (!eventResult.data) return null;

  const titles = parseEmbeddedTitles(titleResult.data);

  return {
    event: EventSchema.parse(eventResult.data),
    titles,
    occurrences: toOccurrences(occurrenceResult.data),
    relatedEvents: await findRelatedEvents(
      eventId,
      titles.map((title) => title.slug),
    ),
  };
});

/**
 * 関連企画の**表示**上限。
 *
 * 「同じ作品の他の企画」は回遊のための補助導線であって一覧ではない。
 * 全件を出したい要求が生まれたら作品ハブ (`/titles/{slug}`) の役目になる。
 */
const RELATED_EVENTS_LIMIT = 12;

/**
 * 候補として取得する **`event_titles` の行数**上限。
 *
 * ⚠️ **表示上限と同じ値にしてはいけない。** この limit が効くのは
 * 「企画の数」ではなく「join 行の数」で、表示までに 2 段階の目減りがある:
 *
 * | 目減りの理由 | 例 |
 * |---|---|
 * | 1 企画が複数作品に紐づくと**同じ企画が行数分重複する** | 3 作品コラボの企画は 3 行を占める |
 * | 公開済み開催を持たない企画を後段で落とす | 候補 12 件全滅なら表示 0 件 |
 *
 * 表示上限と同値にすると、**実際は関連企画があるのにセクションが空に見える**。
 */
const RELATED_EVENTS_CANDIDATE_ROWS = 200;

/**
 * 同じ作品に紐づく他の企画。作品が 1 つも無ければ空配列。
 *
 * ## 自己参照はクエリ側で除く
 *
 * `titleSlugs` は**自分自身の作品 slug 一覧**なので、この条件で引くと対象企画自身が
 * **作品数だけヒットする**。旧実装は「自分が 1 件混ざる」前提で `limit(LIMIT + 1)`
 * としていたが、2 作品以上に紐づく企画では自分自身が 2 行以上を占め、
 * 本来表示すべき関連企画を取得ウィンドウから押し出していた (PR #303 レビュー指摘)。
 *
 * `neq('events.id', ...)` で**クエリの時点で自分を除く**ことで、
 * 「何件余分に取るか」を数える必要そのものを消した。
 *
 * ## 空ページへリンクしない
 *
 * 公開済み (`verified`) の開催を 1 件も持たない企画は、ページを開いても
 * 「会場を選ぶ」が空になる。**リンクを踏んだ先が空**という体験を作らないため、
 * 開催を持つ企画だけに絞る。`listEventParams` が静的生成の対象を
 * 「開催を 1 件以上持つ企画」に限っているのと同じ基準に揃えている。
 */
async function findRelatedEvents(eventId: number, titleSlugs: string[]): Promise<EventSummary[]> {
  if (titleSlugs.length === 0) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('event_titles')
    .select('events!inner(id, name), titles!inner(slug)')
    .in('titles.slug', titleSlugs)
    // 自己参照をクエリ側で除く。作品数に応じて余分に取る必要がなくなる。
    .neq('events.id', eventId)
    // 表示順を DB 任せにしない。名前順なら実行ごとに変わらない。
    .order('name', { ascending: true, referencedTable: 'events' })
    .limit(RELATED_EVENTS_CANDIDATE_ROWS);

  if (error) {
    throw new Error(`failed to load related events: ${error.message}`);
  }

  const rows = z.array(z.object({ events: EventSummarySchema.nullable() })).parse(data ?? []);

  if (rows.length === RELATED_EVENTS_CANDIDATE_ROWS) {
    // 上限に達した = 候補を取りこぼしている可能性がある。黙らせない。
    //
    // Sentry 導入済み (2026-08-15)。level は warning に留める:
    // 表示に漏れが出うるだけで機能は動いており、「誰かが起きて対応すべき」ではない。
    // fingerprint を固定して、event_id ごとに Issue が増えないようにする。
    console.warn(
      `[event] 関連企画の候補が上限 ${RELATED_EVENTS_CANDIDATE_ROWS} 行に達しました ` +
        `(event_id=${eventId})。表示に漏れが出ている可能性があります。`,
    );
    Sentry.captureMessage('関連企画の候補が取得上限に達した', {
      level: 'warning',
      fingerprint: ['related-events-candidate-cap'],
      extra: { eventId, cap: RELATED_EVENTS_CANDIDATE_ROWS },
    });
  }

  // 複数作品に紐づく企画は重複して返るので畳む。Map は挿入順を保つので
  // 上の order がそのまま残る。
  const byId = new Map<number, EventSummary>();
  for (const row of rows) {
    if (row.events) {
      byId.set(row.events.id, row.events);
    }
  }
  if (byId.size === 0) return [];

  // 表示件数の切り詰めは**ここ (表示件数を決める責務の場所)** で行う。
  // withPublishedOccurrences の中でやると、関数名にない 2 つ目の仕事になる。
  const published = await withPublishedOccurrences([...byId.values()]);
  return published.slice(0, RELATED_EVENTS_LIMIT);
}

/**
 * 公開済みの開催を 1 件以上持つ企画だけを残す。順序は入力のまま。
 *
 * `occurrence_view` は anon から読むと `verified = true` の行しか返らないので、
 * 「返ってきた event_id の集合」がそのまま「公開できる企画」になる。
 */
async function withPublishedOccurrences(events: EventSummary[]): Promise<EventSummary[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('occurrence_view')
    .select('eventId:event_id')
    .in(
      'event_id',
      events.map((event) => event.id),
    );

  if (error) {
    throw new Error(`failed to check related events for occurrences: ${error.message}`);
  }

  const withOccurrences = new Set(
    z
      .array(z.object({ eventId: z.number() }))
      .parse(data ?? [])
      .map((row) => row.eventId),
  );

  return events.filter((event) => withOccurrences.has(event.id));
}
