/**
 * Store Derivation Utility
 *
 * @description
 * `occurrences[]` から会場まわりの**派生変数**を導出する純粋関数。
 *
 * ## なぜ必要か (非対称の解消)
 *
 * `lead-generator.service.ts` の `computeEnrichedData` と
 * `text-placeholder-replacer.service.ts` の `computeDerivedVariables` は、
 * **works 系だけ**派生変数を持っている (`primary_work` / `secondary_works` /
 * `is_multi_work` / `コラボ作品名`)。一方 **store 系は `店舗名` を素通しするだけ**で、
 * 「代表会場はどれか」「何会場あるか」を表す変数が存在しない。
 *
 * その結果、LLM が「、」で連結した会場名がそのままリード文と H2 見出しに流れ込んでいた。
 *
 * ```
 * ## トイ・ストーリー5 × OH MY CAFE 表参道ヒルズ、BOX cafe&space ルミネエスト新宿2号店、… のメニュー
 * ```
 *
 * ## ⚠️ 本モジュールはまだ配線されていない (S1-d Phase 1 時点)
 *
 * **上記の本文の連結バグは、本モジュールを追加しただけでは直らない。** 現時点で
 * 直っているのは `occurrences[]` のデータ側 (frontmatter / DB 向け) だけで、
 * その担当は `occurrence-normalizer.ts` である。
 *
 * 本モジュールは **Phase 3 で `lead-generator.service.ts` /
 * `text-placeholder-replacer.service.ts` へ配線するための土台**として先に置いている。
 * Phase 3 の着手には「代表会場名の選び方」の確定が要る (実データでは 5 記事中 2 記事が
 * 複数ブランド跨ぎで、`store.name` をどう選ぶかが決まっていない) ため、意図的に分離した。
 *
 * 配線されるまで `deriveStoreContext` の呼び出し元は存在しない。これは未使用コードでは
 * なく **Phase 3 の前提**である。
 *
 * works 系の重複解消 (2 箇所に同じロジックがある) は本モジュールの担当外
 * (Sprint Refactor-A の領分)。
 *
 * ## 出力する派生変数
 *
 * | 変数 | 導出 |
 * |---|---|
 * | `会場数` | `occurrences.length` (重複会場は畳んで数える) |
 * | `is_multi_venue` | `会場数 >= 2` (既存 `is_multi_work` と対称) |
 * | `会場一覧` | 重複を畳んだ `venue_label` の配列 |
 * | `会場一覧表記` | `会場一覧.join('、')` — **表示用の連結**であって抽出結果ではない |
 * | `代表店舗名` | `store.name` を第一優先、欠落時は先頭会場 |
 *
 * ★ `会場数` は **occurrences の要素数ではなく、ユニークな会場の数**。
 *   同一会場の前期/後期 (実データで 8 会場 × 2 期 = 16 要素の例あり) を
 *   「16 会場」と数えてしまうと本文が事実誤認になる。
 *
 * @module lib/utils/store-derivation
 * @see lib/utils/occurrence-normalizer.ts (本モジュールの前段。連結の分割を担う)
 * @see lib/services/lead-generator.service.ts (works 系派生の既存実装。対称性の参照元)
 */

import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';

/** 表示用に会場名を連結する際の区切り。キャラクター名と同じく読点 (Templates CLAUDE.md §6.1)。 */
const VENUE_JOIN = '、';

export interface DeriveStoreContextInput {
  /** 正規化済みの `occurrences[]`。`normalizeOccurrences` の出力を渡す */
  occurrences?: EventDataOccurrence[] | null;
  /** 抽出結果の `store.name` / `店舗名`。代表店舗名の第一候補 */
  storeName?: string | null;
}

export interface StoreContext {
  /** ユニークな会場の数 (同一会場の複数期間は 1 と数える) */
  会場数: number;
  /** 2 会場以上か。`is_multi_work` と対称 */
  is_multi_venue: boolean;
  /** ユニークな会場名の配列 (出現順) */
  会場一覧: string[];
  /** 表示用の連結。会場がなければ空文字 */
  会場一覧表記: string;
  /** 本文の見出し・リードに使う代表会場名 */
  代表店舗名: string;
}

/**
 * `occurrences[]` から会場の派生変数を導出する。
 *
 * 純粋関数。入力は変更しない。
 *
 * @example
 * deriveStoreContext({
 *   occurrences: [
 *     { venue_label: 'A店', ... }, { venue_label: 'B店', ... },
 *     { venue_label: 'A店', ... },  // 前期/後期で同一会場が 2 回
 *   ],
 *   storeName: 'ブランド名',
 * })
 * // → { 会場数: 2, is_multi_venue: true, 会場一覧: ['A店', 'B店'],
 * //     会場一覧表記: 'A店、B店', 代表店舗名: 'ブランド名' }
 */
export function deriveStoreContext(input: DeriveStoreContextInput): StoreContext {
  const occurrences = input.occurrences ?? [];

  // 同一会場の前期/後期を 1 会場として畳む。出現順は保つ。
  const uniqueLabels: string[] = [];
  const seen = new Set<string>();
  for (const occ of occurrences) {
    const label = occ.venue_label;
    if (typeof label !== 'string' || label.length === 0) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    uniqueLabels.push(label);
  }

  const storeName = typeof input.storeName === 'string' ? input.storeName.trim() : '';

  // 代表店舗名: store.name を第一優先。欠落時は先頭会場へフォールバック。
  //
  // ★ Phase 3 で「代表会場名の選び方」が確定したらここを差し替える。
  //   実データでは 5 記事中 2 記事が複数ブランド跨ぎ (トイ・ストーリー5 は
  //   OH MY CAFE / BOX cafe&space / BALLER:S の 3 ブランド) で、
  //   「ブランド名を代表にする」だけでは決まらないことが分かっている。
  const 代表店舗名 = storeName.length > 0 ? storeName : (uniqueLabels[0] ?? '');

  return {
    会場数: uniqueLabels.length,
    is_multi_venue: uniqueLabels.length >= 2,
    会場一覧: uniqueLabels,
    会場一覧表記: uniqueLabels.join(VENUE_JOIN),
    代表店舗名,
  };
}
