import { z } from 'zod';

import { EVENT_NAME_FALLBACK } from '@/lib/event/contracts';
import {
  ONGOING_OCCURRENCE_COLUMNS,
  OngoingOccurrenceRowSchema,
  type OngoingOccurrence,
  type RailTitle,
} from '@/lib/home/contracts';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * トップページ (`/`) の DB 読み取り。
 *
 * ## 見える範囲
 *
 * anon 接続 + `security_invoker = on` により `occurrence_view` は
 * **`verified = true` の開催のみ**。未承認の開催はそもそも返らない。
 *
 * ## 資格情報が無いビルドでも通す
 *
 * CI の `Build Apps` は Supabase の変数を渡さない。トップは**開催が 0 件でも
 * 成立するページ** (探す導線・記事・About が残る) なので、資格情報が無ければ
 * 空配列を返してレンダリングを続ける。`listTitleParams` 等と違い静的生成の
 * 対象集合を決めないため、ここで throw する理由が無い。
 */

/**
 * 開催中の開催をすべて取得する (Claude Design v5 #1 の「開催中」rail)。
 *
 * ## 並び順 = 終わりが近い順
 *
 * v5 は rail の 2 枚目に「もうすぐ終了 / あと3日」を置いており、**終了が近い
 * ものほど前に出す**意図が読み取れる。「まだ間に合う」を優先して見せる並びなので
 * `ends_on` 昇順。`ends_on` が null (終了日未定 / 常設) は**末尾**へ回す
 * (急ぐ理由が無いため)。`id` は range ページングのタイブレーク (全順序)。
 *
 * ⚠️ 並びは**基底テーブルの列だけ**で作る。埋め込み先 (`events.name` 等) の
 *    order は全順序を保証せず、range ページングで行の重複・欠落を招く
 *    (#333 Codex 指摘)。
 *
 * ## 件数の上限を置かない
 *
 * 「開催中」は日付で自然に絞られる集合 (同時開催しているものだけ) なので、
 * `db.max_rows` を跨ぐ規模になるとは考えにくい。それでも `fetchAllRows` を
 * 通すのは、**無言の打ち切りを構造的に不可能にする**ためで、
 * ページング規律を他の一覧と揃える意味もある。
 */
export async function listOngoingOccurrences(): Promise<OngoingOccurrence[]> {
  if (!hasPublicSupabaseCredentials()) return [];

  const supabase = createPublicClient();

  const rows = await fetchAllRows({
    label: 'ongoing occurrences',
    fetchPage: (from, to) =>
      supabase
        .from('occurrence_view')
        .select(ONGOING_OCCURRENCE_COLUMNS)
        .eq('status', 'ongoing')
        .order('ends_on', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to),
  });

  return z
    .array(OngoingOccurrenceRowSchema)
    .parse(rows)
    .map((row) => ({
      id: row.id,
      eventId: row.eventId,
      slug: row.slug,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      eventName: row.events?.name ?? EVENT_NAME_FALLBACK,
      categoryName: row.events?.primaryCategory?.name ?? null,
      titles: parseRailTitles(row.events?.eventTitles ?? []),
      venueName: row.venues?.name ?? null,
      // 都道府県・市区は null を取り得る (データ源が無い項目は置かない)。
      venueRegion: [row.venues?.prefecture, row.venues?.city].filter(Boolean).join(' '),
    }));
}

/** 埋め込みから作品を取り出す。null を落とし、名前順で安定させる。 */
function parseRailTitles(rows: { titles: RailTitle | null }[]): RailTitle[] {
  return rows
    .map((row) => row.titles)
    .filter((title): title is RailTitle => title !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.slug.localeCompare(b.slug));
}

/** 「いま行ける作品」1 枚ぶん。 */
export type TitlePick = {
  slug: string;
  name: string;
  /** この作品の**開催中**の開催数。並び順のキーでもある。 */
  ongoingCount: number;
};

/**
 * ピックアップ作品の**表示上限**。
 *
 * v5 #1 は 3 枚を横並びで描いているが、**3 件固定にはしない** (2026-08-22 BOSS 確定)。
 * 作品が増えたら横スクロールで 10 件まで見せる。上限を置くのはトップの
 * ページ重量を抑えるためで、全件を見たい要求は `/titles` が受ける。
 */
export const TITLE_PICK_LIMIT = 10;

/**
 * 「いま開催中の作品」を開催数の多い順に返す (最大 `TITLE_PICK_LIMIT` 件)。
 *
 * ## なぜこの選び方なのか
 *
 * v5 #1 の「ピックアップ作品」は **Claude Design 側が独自に置いたセクション**で、
 * 順位付けの根拠になる列 (人気度・編集フラグ) は `titles` に存在しない
 * (2026-08-22 BOSS 確認)。編集判断のデータ源が無いものを勝手に作らず、
 * **「開催中の開催を持つ作品を、開催中の開催数が多い順」**という
 * `occurrence_view` から機械的に決まる基準に置き換えた (BOSS 承認)。
 * 「いま行ける作品」が並ぶので、探す導線としての意味もセクション名と一致する。
 *
 * ## 並びの安定性
 *
 * 同数の作品は**名前順 → slug 順**で決める。件数だけで並べると、同数の作品の
 * 順序がビルドごとに変わって差分がノイズになる。
 *
 * ## 開催中の開催を 2 回引かない
 *
 * 呼び出し側 (トップ) は rail 用に `listOngoingOccurrences()` を既に呼んでいるので、
 * **その結果を渡してもらって集計する** (引数を取る純粋関数に寄せる)。
 * 同じ `occurrence_view` を 2 周しないための形。
 */
export function pickOngoingTitles(occurrences: readonly OngoingOccurrence[]): TitlePick[] {
  const byTitle = new Map<string, TitlePick>();

  for (const occurrence of occurrences) {
    for (const title of occurrence.titles) {
      const current = byTitle.get(title.slug);
      if (current) {
        current.ongoingCount += 1;
      } else {
        byTitle.set(title.slug, { slug: title.slug, name: title.name, ongoingCount: 1 });
      }
    }
  }

  return [...byTitle.values()]
    .sort(
      (a, b) =>
        b.ongoingCount - a.ongoingCount ||
        a.name.localeCompare(b.name, 'ja') ||
        a.slug.localeCompare(b.slug),
    )
    .slice(0, TITLE_PICK_LIMIT);
}
