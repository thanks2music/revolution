import { OccurrenceViewSchema } from '@revolution/schemas/occurrence';
import { VenueSchema as VenueRowSchema } from '@revolution/schemas/venue';
import { cache } from 'react';
import { z } from 'zod';

import {
  EVENT_COLUMNS,
  EVENT_TITLES_COLUMNS,
  EventSchema,
  parseEmbeddedTitles,
  type Title,
} from '@/lib/event/contracts';
import { parseCanonicalId } from '@/lib/route-params';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * 開催 (occurrence) の読み取り。
 *
 * ## 型の真実源は zod
 *
 * `occurrence_view` は **view のため Drizzle 定義が無く**、Supabase の型生成も
 * このリポジトリには存在しない。したがって `shared/schemas/` の zod 契約が
 * 唯一の真実源であり、**境界で必ず `parse()` を通す**。
 *
 * ## snake_case → camelCase は PostgREST の別名で吸収する
 *
 * zod 契約は Drizzle のプロパティ名 (camelCase) で作られているが、PostgREST が
 * 返すのは DB の列名 (snake_case)。select に `別名:列名` を書いて**取得時点で
 * 契約側の名前に揃える**。アプリ側で詰め替えると、詰め替えコードが第 2 の
 * 契約になって zod と二重管理になるため、ここで閉じる。
 *
 * ## 読む列を絞っている理由
 *
 * `createdAt` / `cancelledAt` は zod 側が **`Date` を期待する** (drizzle-zod が
 * timestamp を `z.date()` に写すため) 一方、PostgREST は ISO 文字列を返す。
 * 全列を取ると parse がそこで落ちる。ページが必要としない列なので
 * `.pick()` で契約ごと絞り、**「読んでいる列 = 検証している列」**を一致させる。
 *
 * ## 見える範囲
 *
 * anon 接続 + `security_invoker = on` により **`verified = true` の開催のみ**。
 * 未承認の開催はそもそも返らないので、呼び出し側で絞る必要はない。
 */

/**
 * 会場。開催に**埋め込んで**取得する。
 *
 * ⚠️ **view でも PostgREST の埋め込みは効く** (2026-08-14 実測)。
 * PostgREST は view の FK を基底テーブルから推論するため、
 * `occurrence_view?select=...,venues(name)` が会場を返す (anon key で確認済み)。
 *
 * 以前ここには「view なので埋め込みが効かない」と書いて**追加クエリ + Map による
 * 会場名解決を実装していたが、その前提は誤りだった**。埋め込みに寄せたことで、
 * 会場用のクエリ 2 本と解決コード約 30 行が不要になった。
 */
const OccurrenceVenueSchema = VenueRowSchema.pick({
  slug: true,
  name: true,
  prefecture: true,
  city: true,
  address: true,
});

export type OccurrenceVenue = z.infer<typeof OccurrenceVenueSchema>;

/** ページが実際に読む列 + 埋め込んだ会場。 */
export const OccurrenceRowSchema = OccurrenceViewSchema.pick({
  id: true,
  eventId: true,
  venueLabel: true,
  slug: true,
  startsOn: true,
  endsOn: true,
  status: true,
}).extend({
  /** 会場マスタを持たない開催 (オンライン / 一時会場) では null。 */
  venues: OccurrenceVenueSchema.nullable(),
});

/** 上記に対応する PostgREST の select 句 (別名で camelCase へ揃える)。 */
export const OCCURRENCE_COLUMNS =
  'id, eventId:event_id, venueLabel:venue_label, slug, startsOn:starts_on, endsOn:ends_on, status, venues(slug, name, prefecture, city, address)';

/** 表示用の開催。会場表示名を解決済みで持つ。 */
export type Occurrence = z.infer<typeof OccurrenceRowSchema> & {
  /** 解決済みの会場表示名。会場マスタも `venue_label` も無ければ null。 */
  venueName: string | null;
};

/**
 * 会場表示名の解決 (Layer 1、純粋関数)。
 *
 * 解決順は **会場マスタ名 → `venue_label` → null**。
 * ⚠️ **`slug` で代用しない。** slug は URL 用の識別子であって人が読む名前ではない。
 *
 * 規則をこの 1 箇所に閉じる。以前はページ側にも同じ式が散っていて、
 * `'会場未定'` のリテラルが 3 箇所にあった。
 */
export function resolveVenueName(row: z.infer<typeof OccurrenceRowSchema>): string | null {
  return row.venues?.name ?? row.venueLabel;
}

/** 取得結果を表示用の形へ。会場名の解決を通す唯一の入口。 */
export function toOccurrences(data: unknown): Occurrence[] {
  return z
    .array(OccurrenceRowSchema)
    .parse(data ?? [])
    .map((row) => ({ ...row, venueName: resolveVenueName(row) }));
}

export type OccurrencePageData = {
  occurrence: Occurrence;
  event: z.infer<typeof EventSchema>;
  titles: Title[];
  /** 同じ企画の他の開催 (自分を除く)。 */
  siblings: Occurrence[];
};

/**
 * `generateStaticParams` 用。公開済み開催の (企画 ID, 開催 slug) を列挙する。
 *
 * ## 0 件を「異常」として扱わない
 *
 * S3 (取り込みパイプライン) が繋がるまで本番の occurrences は空であり、
 * それは設計どおりの状態 (`strategy.md` §5-2: S3 の依存が S2)。
 * ここで throw すると本番ビルドが落ちる。
 *
 * ## 資格情報が無いビルドでも通す
 *
 * CI の `Build Apps` は Supabase の変数を渡さない (`hasPublicSupabaseCredentials`
 * の docstring 参照)。**資格情報が無い = 静的生成できないが、それはビルドの
 * 失敗ではない**ので 0 パスを返し、実行時のオンデマンド生成に委ねる
 * (`dynamicParams` は既定で true)。
 *
 * 一方 **資格情報があるのにクエリが失敗した場合は throw する**。ここを一律
 * catch にすると、Vercel 本番ビルドで DB が落ちていても 0 ページで静かに成功し、
 * 「ページが 1 枚も出ない」ことに気づけなくなる。
 */
export async function listOccurrenceParams(): Promise<{ id: string; occurrence_slug: string }[]> {
  if (!hasPublicSupabaseCredentials()) {
    // 黙って 0 件にしない。ビルドログに理由を残す。
    console.warn(
      '[occurrence] Supabase の公開接続情報が無いため、開催ページの静的生成をスキップしました ' +
        '(資格情報を持たないビルドでは想定どおり)。ページは実行時にオンデマンド生成されます。',
    );
    return [];
  }

  const supabase = createPublicClient();

  // 全件列挙なので単発 select にしない (理由は `lib/supabase/paginate.ts`)。
  const rows = await fetchAllRows({
    label: 'occurrence params',
    fetchPage: (from, to) =>
      supabase
        .from('occurrence_view')
        .select('eventId:event_id, slug')
        .order('id', { ascending: true })
        .range(from, to),
  });

  return z
    .array(z.object({ eventId: z.number(), slug: z.string() }))
    .parse(rows)
    .map((row) => ({ id: String(row.eventId), occurrence_slug: row.slug }));
}

/**
 * 開催詳細 1 件 + 表示に要る周辺データ。見つからなければ null。
 *
 * ## 当該企画の開催を 1 回で引いて JS で分ける
 *
 * 本体と「この企画の他の開催」は **同じ `occurrence_view where event_id = X` の
 * 部分集合**なので、述語を変えて 2 回叩く必要がない。1 回引いて `slug` で分ければ
 * クエリが 1 本減り、かつ**本体の取得完了を待たずに** events / titles を
 * 同時に投げられる (往復の深さが 3 段 → 2 段)。
 *
 * `eventId` は URL 由来の文字列なので、**正準形でなければ問い合わせずに** null を
 * 返す (`/events/abc/...` で DB へ無駄に投げない + `/events/2.0` のような
 * 表記ゆれを 404 にして重複コンテンツを作らない)。
 *
 * ## `React.cache()` でリクエスト内メモ化する
 *
 * 本関数は `generateMetadata` とページ本体の**両方から同じ引数で呼ばれる**。
 * Next.js が自動 dedup するのは `fetch()` であって、supabase-js が内部で何を
 * 使うかに依存する暗黙の挙動。**同じクラスの問題を `lib/auth/current-user.ts`
 * で既に踏んで `React.cache()` で直した実績がある**ので、同じ形で明示的に閉じる。
 *
 * ⚠️ `cache()` が効くのは**同一 render パス内だけ**。`sitemap.ts` のような
 *    render 外の呼び出しには効かない (2026-08-14 実測)。
 */
export const getOccurrenceDetail = cache(async function getOccurrenceDetail(
  eventIdRaw: string,
  occurrenceSlug: string,
): Promise<OccurrencePageData | null> {
  // 表記ゆれ (`2.0` / `0x2` / `02` …) を 404 にする。理由は `lib/route-params.ts`。
  const eventId = parseCanonicalId(eventIdRaw);
  if (eventId === null) return null;

  const supabase = createPublicClient();

  // ⚠️ **builder を変数に置いて片方だけ先に await しない。**
  //    `postgrest-js` のビルダは lazy な PromiseLike で、`.then()` が呼ばれた
  //    時点で fetch が飛ぶ。`Promise.all` の引数として直接構築すれば同時に飛ぶ
  //    (実測 2026-08-14: 変数に置くと逐次、この形なら両方 +1ms で同時)。
  const [occurrenceResult, eventResult, titleResult] = await Promise.all([
    supabase
      .from('occurrence_view')
      .select(OCCURRENCE_COLUMNS)
      .eq('event_id', eventId)
      // 明示的に並べる。既定順は PostgREST / DB 任せで、行が増えたときに
      // 表示順が黙って変わる。日程未発表 (starts_on is null) は末尾へ。
      .order('starts_on', { ascending: true, nullsFirst: false }),
    supabase.from('events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle(),
    supabase.from('event_titles').select(EVENT_TITLES_COLUMNS).eq('event_id', eventId),
  ]);

  // ⚠️ **3 つすべてのエラーを見る**。PostgREST は失敗時に error を立てて data を
  //    null にするため、error を見ないと「クエリが落ちた」が「該当 0 件」と
  //    区別できない。実在する開催が消えても画面上は正常に見えてしまう。
  for (const [label, result] of [
    ['occurrences', occurrenceResult],
    ['event', eventResult],
    ['titles', titleResult],
  ] as const) {
    if (result.error) {
      throw new Error(`failed to load ${label}: ${result.error.message}`);
    }
  }

  // 企画が引けない開催は URL としては生きているが実体が無い。404 に倒す。
  if (!eventResult.data) return null;

  const occurrences = toOccurrences(occurrenceResult.data);
  const occurrence = occurrences.find((row) => row.slug === occurrenceSlug);
  if (!occurrence) return null;

  return {
    occurrence,
    event: EventSchema.parse(eventResult.data),
    titles: parseEmbeddedTitles(titleResult.data),
    siblings: occurrences.filter((row) => row.slug !== occurrenceSlug),
  };
});
