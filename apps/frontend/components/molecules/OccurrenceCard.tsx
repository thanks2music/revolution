import Link from 'next/link';

import { RemainingDaysBadge } from '@/components/atoms/badge/RemainingDaysBadge';
import { StatusBadge } from '@/components/atoms/badge/StatusBadge';
import { getOccurrenceUrl } from '@/lib/event/event-url';
import { formatPeriod } from '@/lib/occurrence/format';
import type { Occurrence } from '@/lib/occurrence/queries';
import { toBadgeStatus } from '@/lib/occurrence/status';

/**
 * 開催の一覧行。企画ページの「会場を選ぶ」と開催詳細ページの
 * 「この企画の他の開催」で共有する。
 *
 * ## 共通化した理由 (rule-of-3 の例外ではない)
 *
 * 2 箇所しか無いので DRY の「3 つで抽象化」には届かない。それでも共通化したのは
 * **先回りの抽象化ではなく、既に発生していた不整合の是正**だから。
 *
 * 企画ページのカードは開催中に残日数を出していたが、開催詳細ページの
 * 「この企画の他の開催」は**同じ Link・同じ className・同じ 3 要素なのに
 * 残日数を出していなかった**。同じ意味の UI が 2 つの見た目を持っていた。
 * className が 1 文字も違わなかったことが、これが同一コンポーネントである
 * ことを示している。
 *
 * ⚠️ **パンくずは共通化しない。** セグメント構成が 3 段 / 4 段で異なり、
 * 末尾がテキストかリンクかも違う。共通化すると `items: {label, href?}[]` を
 * 組み立てる config API が必要になり、JSX 直書きより読解コストが上がる。
 * 3 つ目のページ (作品ハブ) が来た時点で再判定する。
 *
 * ## PC では 2 列止まりにする (呼び出し側の規約)
 *
 * 本カードは **横 1 行型** (`flex flex-wrap items-center`) で、バッジ・会場名・
 * 期間を横に並べて「1 行で読ませる」ことに価値がある。器 (`w-main`) は最大
 * 1050px なので、`lg:grid-cols-3` にすると 1 列が約 295px になり **毎行が 2 段へ
 * 折れて 1 行で読める利点が消える**。よって本カードを並べるリストは
 * `md:grid-cols-2` を上限とする。
 *
 * 縦積みの `EventOccurrenceCard` (バッジ行 → 企画名 → 会場・期間) にはこの制約が
 * 無いため、あちらを並べるリストは 3 列まで伸ばしてよい。列数の一覧と検証は
 * `e2e/layout.spec.ts` が持つ。
 */

/** 会場名が解決できないときの表示。`slug` で代用しない (URL 識別子は名前ではない)。 */
export const VENUE_NAME_FALLBACK = '会場未定';

type Props = {
  eventId: number;
  occurrence: Occurrence;
};

export const OccurrenceCard = ({ eventId, occurrence }: Props) => (
  <Link
    href={getOccurrenceUrl(eventId, occurrence.slug)}
    // 器 (角丸・影・hover) は `EventOccurrenceCard` と揃える。揃えないと
    // 「同じ意味の UI が 2 つの見た目を持つ」状態が復活する (本ファイルの
    // docstring が是正した不整合と同型)。違うのは**主表示が会場名か企画名か**だけ。
    className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--line-soft)] bg-bg-elevated p-3 shadow-sm transition-colors hover:border-primary-300"
  >
    <StatusBadge status={toBadgeStatus(occurrence.status)} />
    {/*
      残日数は **開催中のときだけ**出す。

      「あと N 日」は `ends_on` までの日数 = 「行ける残り時間」。開催前に出すと
      読み手は「開始まであと N 日」と読むため**意味が反転して伝わる**
      (実測: 開始まで 14 日の開催に「あと 45 日」と表示されていた)。
      開催前の煽りは状態バッジ側の "Coming Soon" が担う。
      終了・中止・日程未発表は残り時間の概念そのものが無い。
    */}
    {occurrence.status === 'ongoing' && <RemainingDaysBadge endsOn={occurrence.endsOn} />}
    <span className="font-display text-ink-strong">
      {occurrence.venueName ?? VENUE_NAME_FALLBACK}
    </span>
    <span className="font-numeric tabular-nums text-sm text-ink-muted">
      {formatPeriod(occurrence.startsOn, occurrence.endsOn)}
    </span>
  </Link>
);
