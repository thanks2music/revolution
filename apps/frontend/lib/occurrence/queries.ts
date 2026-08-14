import { OccurrenceViewSchema } from '@revolution/schemas/occurrence';
import { cache } from 'react';
import { z } from 'zod';

import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * 開催 (occurrence) の読み取り。
 *
 * ## 型の真実源は zod (`OccurrenceViewSchema`)
 *
 * `occurrence_view` は **view のため Drizzle 定義が無く**、Supabase の型生成も
 * このリポジトリには存在しない。したがって
 * `shared/schemas/occurrence.ts` の zod 契約が唯一の真実源であり、
 * **境界で必ず `parse()` を通す**。
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
 * 将来 `cancelledAt` が要るようになったら、その時に coerce を足す。
 *
 * ## 見える範囲
 *
 * anon 接続 + `security_invoker = on` により **`verified = true` の開催のみ**。
 * 未承認の開催はそもそも返らないので、呼び出し側で絞る必要はない。
 */

/** ページが実際に読む列だけに絞った契約。真実源は `OccurrenceViewSchema`。 */
export const OccurrenceDetailSchema = OccurrenceViewSchema.pick({
  id: true,
  eventId: true,
  venueId: true,
  venueLabel: true,
  slug: true,
  startsOn: true,
  endsOn: true,
  status: true,
});

export type OccurrenceDetail = z.infer<typeof OccurrenceDetailSchema>;

/** 上記に対応する PostgREST の select 句 (別名で camelCase へ揃える)。 */
export const OCCURRENCE_COLUMNS =
  'id, eventId:event_id, venueId:venue_id, venueLabel:venue_label, slug, startsOn:starts_on, endsOn:ends_on, status';

const EventSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  officialUrl: z.string().nullable(),
});

const VenueSchema = z.object({
  slug: z.string(),
  name: z.string(),
  prefecture: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
});

const TitleSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

/**
 * 一覧表示用の開催。会場名を解決済みで持つ。
 *
 * `occurrence_view` は view のため PostgREST の埋め込み (`venues(name)`) が効かない
 * (FK メタデータが無い)。会場名は別クエリで引いて**ここで解決してから**返す。
 * 解決をページ側に残すと、開催を並べる画面 (企画 / 作品 / 会場ページ) ごとに
 * 同じ解決コードが増えるため、取得層で閉じる。
 */
export type OccurrenceListItem = OccurrenceDetail & {
  /** 会場マスタ名 → `venue_label` → null の順に解決した表示名。 */
  venueName: string | null;
};

export type OccurrencePageData = {
  occurrence: OccurrenceDetail;
  event: z.infer<typeof EventSchema>;
  venue: z.infer<typeof VenueSchema> | null;
  titles: z.infer<typeof TitleSchema>[];
  /** 同じ企画の他の開催 (自分を除く)。 */
  siblings: OccurrenceListItem[];
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
 * ## 資格情報が無いビルドでも通す (2026-08-14、CI 失敗を受けて追加)
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
export async function listOccurrenceParams(): Promise<
  { id: string; occurrence_slug: string }[]
> {
  if (!hasPublicSupabaseCredentials()) {
    // 黙って 0 件にしない。ビルドログに理由を残す。
    console.warn(
      '[occurrence] Supabase の公開接続情報が無いため、開催ページの静的生成をスキップしました ' +
        '(資格情報を持たないビルドでは想定どおり)。ページは実行時にオンデマンド生成されます。',
    );
    return [];
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('occurrence_view')
    .select('eventId:event_id, slug');

  if (error) {
    // ビルドを黙って 0 件で通すと「ページが 1 枚も出ない」ことに気づけない。
    // 取得自体の失敗は明示的に落とす (0 件との区別が要点)。
    throw new Error(`failed to list occurrence params: ${error.message}`);
  }

  return z
    .array(z.object({ eventId: z.number(), slug: z.string() }))
    .parse(data ?? [])
    .map((row) => ({ id: String(row.eventId), occurrence_slug: row.slug }));
}

/**
 * 開催詳細 1 件 + 表示に要る周辺データ。見つからなければ null。
 *
 * `eventId` は URL 由来の文字列なので、数値化に失敗したら**問い合わせずに**
 * null を返す (`/events/abc/...` のような入力で DB へ無駄に投げない)。
 *
 * ## `React.cache()` でリクエスト内メモ化する
 *
 * 本関数は `generateMetadata` とページ本体の**両方から同じ引数で呼ばれる**。
 * 1 回の呼び出しで最大 6 クエリ (occurrence / event / venue / titles /
 * siblings / siblings の会場名) を投げるため、素の関数のままだと DB 往復が倍になる。
 *
 * Next.js が自動 dedup するのは `fetch()` であって、supabase-js が内部で何を
 * 使うかに依存する暗黙の挙動。**同じクラスの問題を `lib/auth/current-user.ts`
 * で既に踏んで `React.cache()` で直した実績がある**ので、同じ形で明示的に閉じる。
 */
export const getOccurrenceDetail = cache(async function getOccurrenceDetail(
  eventIdRaw: string,
  occurrenceSlug: string,
): Promise<OccurrencePageData | null> {
  const eventId = Number(eventIdRaw);
  if (!Number.isInteger(eventId) || eventId <= 0) return null;

  const supabase = createPublicClient();

  const { data: occurrenceRow, error: occurrenceError } = await supabase
    .from('occurrence_view')
    .select(OCCURRENCE_COLUMNS)
    .eq('event_id', eventId)
    .eq('slug', occurrenceSlug)
    .maybeSingle();

  if (occurrenceError) {
    throw new Error(`failed to load occurrence: ${occurrenceError.message}`);
  }
  if (!occurrenceRow) return null;

  const occurrence = OccurrenceDetailSchema.parse(occurrenceRow);

  const [eventResult, venueResult, titleResult, siblingResult] = await Promise.all([
    supabase
      .from('events')
      .select('id, slug, name, description, officialUrl:official_url')
      .eq('id', eventId)
      .maybeSingle(),
    occurrence.venueId
      ? supabase
          .from('venues')
          .select('slug, name, prefecture, city, address')
          .eq('id', occurrence.venueId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // event_titles は titles への FK を持つので PostgREST の埋め込みが効く。
    supabase.from('event_titles').select('titles(slug, name)').eq('event_id', eventId),
    supabase
      .from('occurrence_view')
      .select(OCCURRENCE_COLUMNS)
      .eq('event_id', eventId)
      .neq('slug', occurrenceSlug)
      // 明示的に並べる。既定順は PostgREST / DB 任せで、行が増えたときに
      // 表示順が黙って変わる。日程未発表 (starts_on is null) は末尾へ。
      .order('starts_on', { ascending: true, nullsFirst: false }),
  ]);

  // ⚠️ **4 つすべてのエラーを見る**。PostgREST は失敗時に error を立てて
  // data を null にするため、error を見ないと「クエリが落ちた」が
  // 「該当 0 件」と区別できない。会場が理由なく「会場未定」になったり、
  // 実在する他開催が消えたりしても、画面上は正常に見えてしまう。
  // 本ファイルの他の箇所 (listOccurrenceParams / attachVenueNames) は
  // 既に throw しており、ここだけ抜けていた (PR #302 レビュー指摘)。
  for (const [label, result] of [
    ['event', eventResult],
    ['venue', venueResult],
    ['titles', titleResult],
    ['siblings', siblingResult],
  ] as const) {
    if (result.error) {
      throw new Error(`failed to load ${label}: ${result.error.message}`);
    }
  }

  // 企画が引けない開催は URL としては生きているが実体が無い。404 に倒す。
  if (!eventResult.data) return null;

  const siblings = z.array(OccurrenceDetailSchema).parse(siblingResult.data ?? []);

  return {
    occurrence,
    event: EventSchema.parse(eventResult.data),
    venue: venueResult.data ? VenueSchema.parse(venueResult.data) : null,
    titles: z
      .array(z.object({ titles: TitleSchema.nullable() }))
      .parse(titleResult.data ?? [])
      .map((row) => row.titles)
      .filter((t): t is z.infer<typeof TitleSchema> => t !== null),
    siblings: await attachVenueNames(siblings),
  };
});

/**
 * 開催の配列に会場名を付ける。会場は 1 クエリでまとめて引く (N+1 を作らない)。
 *
 * 会場マスタを持たない開催 (`venue_id is null`) は `venue_label` を使う。
 * どちらも無い場合は null を返し、**slug で代用しない** — slug は URL 用の
 * 識別子であって人が読む名前ではないため、画面に出すと機械的な文字列が露出する。
 */
export async function attachVenueNames(rows: OccurrenceDetail[]): Promise<OccurrenceListItem[]> {
  const venueIds = [...new Set(rows.map((r) => r.venueId).filter((v): v is number => v !== null))];

  const nameById = new Map<number, string>();
  if (venueIds.length > 0) {
    const supabase = createPublicClient();
    const { data, error } = await supabase.from('venues').select('id, name').in('id', venueIds);
    if (error) {
      throw new Error(`failed to load venues: ${error.message}`);
    }
    for (const venue of z
      .array(z.object({ id: z.number(), name: z.string() }))
      .parse(data ?? [])) {
      nameById.set(venue.id, venue.name);
    }
  }

  return rows.map((row) => ({
    ...row,
    venueName:
      (row.venueId !== null ? (nameById.get(row.venueId) ?? null) : null) ?? row.venueLabel,
  }));
}
