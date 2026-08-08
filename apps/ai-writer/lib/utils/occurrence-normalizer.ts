/**
 * Occurrence Normalizer Utility
 *
 * @description
 * LLM が返した `event_data.occurrences[]` を、**1 要素 = 1 開催 (会場 × 期間)**
 * の不変条件へ揃える防御層。
 *
 * `store-name-validator.ts` と同じ設計思想に立つ — YAML テンプレートで
 * ルールを定義していても **AI が 100% 従うとは限らない**ため、アプリ側でも
 * 防御的にチェックする。プロンプトを直したあとも LLM が旧挙動へ回帰しうるので、
 * ここが恒久的な回帰ガードになる。
 *
 * ## なぜ必要か (2026-08-07 実測)
 *
 * dry-run 3 本すべてで `occurrences` が 1 件しか出ず、5 会場のイベントでも
 * `venue_label` が「A、B、C、D、E」と連結された 1 文字列になっていた。
 * LLM 自身が「店舗は 3 店舗だが MVP では occurrences 1件に集約」と申告しており、
 * 集約を命じていたのは `2-extraction.yaml` のプロンプト指示だった。
 *
 * ## 正規化の内容
 *
 * | 処理 | 根拠 |
 * |---|---|
 * | `、` を含む `venue_label` を分割 | 上記の集約バグの回帰ガード |
 * | `・` は**分割しない** | 「ルミネエスト新宿 1号店・2号店」は原文が 1 行 1 住所で 1 会場として扱う |
 * | 空白 trim (U+3000 含む) / 空要素除去 | Sprint A/B の Unicode-aware CHECK と同じ扱い |
 * | 同一 (venue_label, starts_on) の重複除去 | 同一会場でも**期間が違えば別開催**として残す (前期/後期) |
 * | `ends_on < starts_on` なら終了年 +1 | 年跨ぎで終了年が省略される実例が冬シーズンに集中 |
 * | 会場数と `開催都道府県` 数の不一致を warn | throw はしない (observability 規約) |
 *
 * ## しないこと
 *
 * - **日付の捏造**。`starts_on` が読めなければ `null` のまま通す。必須にしていた
 *   ために `2025-01-01〜2025-12-31` のような 1 年間まるごとの捏造が実際に出ていた
 * - **会場名が個別列挙されないケースの分割**。「全国17箇所のイオンモール内スペース」は
 *   店名も住所も原文にないため、1 要素のまま保存する (BOSS 確定 2026-08-09)
 *
 * @module lib/utils/occurrence-normalizer
 * @see shared/schemas/mdx-frontmatter.ts (EventDataOccurrenceSchema)
 * @see lib/utils/store-name-validator.ts (同じ「防御的チェック」の先例)
 */

import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';

/**
 * 会場の区切りとして扱う文字。
 *
 * ★ `・` を含めてはならない。会場名の**内部**に現れる (「1号店・2号店」) ため、
 *   分割すると原文にない会場を作り出してしまう。キャラクター名で「キャラ間は
 *   読点、名前内部の中黒は保持」としているのと同じ判断 (Templates CLAUDE.md §6.1)。
 */
const VENUE_SEPARATOR = /、/;

/** 全角空白を含む trim 対象。Sprint A/B の DB CHECK と文字集合を揃える。 */
const TRIM_CHARS = /^[\s　]+|[\s　]+$/g;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `normalizeOccurrences` の入力。extraction 結果のうち正規化に必要な分だけ受け取る。 */
export interface NormalizeOccurrencesInput {
  /** LLM が返した `event_data.occurrences[]`。undefined / 空配列も許容 */
  occurrences?: EventDataOccurrence[] | null;
  /**
   * 会場数の妥当性チェックに使う。`開催都道府県` は会場関連で唯一
   * 「複数を配列で保持できる」既存フィールドのため、cross-check の信号になる。
   */
  prefectures?: string[] | null;
  /** `starts_on` / `ends_on` が欠落した要素を補完するための既定期間 */
  fallbackPeriod?: { startsOn?: string | null; endsOn?: string | null };
}

/** 正規化の結果。`warnings` は呼び出し側がログへ出す。 */
export interface NormalizeOccurrencesResult {
  occurrences: EventDataOccurrence[];
  warnings: string[];
}

function trimLabel(value: string): string {
  return value.replace(TRIM_CHARS, '');
}

/**
 * `ends_on < starts_on` を「終了年の省略」とみなして +1 年する。
 *
 * @description
 * 「2025年12月20日（土）〜2月8日（日）」のように**終了側の年が書かれない**表記が
 * 冬シーズンのイベントに集中する。素直にパースすると `2025-12-20 〜 2025-02-08` と
 * 逆転するため、逆転していたら終了年を 1 つ進める。
 *
 * 2 年以上の逆転は補正しない (データ異常として warn に回す)。
 */
function correctYearWrap(
  startsOn: string,
  endsOn: string
): { endsOn: string; corrected: boolean } {
  if (endsOn >= startsOn) return { endsOn, corrected: false };

  const m = ISO_DATE.exec(endsOn);
  if (!m) return { endsOn, corrected: false };

  const bumped = `${String(Number(m[1]) + 1)}-${m[2]}-${m[3]}`;
  // +1 年しても解消しない (= 2 年以上の逆転) なら異常値。触らない。
  if (bumped < startsOn) return { endsOn, corrected: false };

  return { endsOn: bumped, corrected: true };
}

/**
 * `occurrences[]` を「1 要素 = 1 開催」の形へ正規化する。
 *
 * 純粋関数。入力配列は変更しない。
 *
 * @example
 * // 連結された 1 要素 → 3 要素へ分割
 * normalizeOccurrences({
 *   occurrences: [{ venue_slug: null, venue_label: 'A店、B店、C店',
 *     starts_on: '2026-07-03', ends_on: '2026-09-13', official_url: null }],
 * })
 * // → occurrences 3 件、warnings に分割の記録
 */
export function normalizeOccurrences(
  input: NormalizeOccurrencesInput
): NormalizeOccurrencesResult {
  const warnings: string[] = [];
  const source = input.occurrences ?? [];

  if (source.length === 0) {
    return { occurrences: [], warnings };
  }

  const expanded: EventDataOccurrence[] = [];

  for (const occ of source) {
    const label = typeof occ.venue_label === 'string' ? trimLabel(occ.venue_label) : null;

    // --- 連結された会場名の分割 (今回の実測バグの回帰ガード) ---
    const labels =
      label && VENUE_SEPARATOR.test(label)
        ? label
            .split(VENUE_SEPARATOR)
            .map(trimLabel)
            .filter((s) => s.length > 0)
        : [label];

    if (labels.length > 1) {
      warnings.push(
        `venue_label に「、」区切りの連結を検出したため ${labels.length} 件へ分割しました: "${label}"。` +
          `プロンプト側で会場ごとに 1 occurrence を出力できていない可能性があります。`
      );
    }

    for (const venueLabel of labels) {
      // 空文字は null に寄せる (schema は nullable、min(1) のため空文字は不正)
      expanded.push({
        ...occ,
        venue_label: venueLabel && venueLabel.length > 0 ? venueLabel : null,
      });
    }
  }

  // --- 日付の補完と年跨ぎ補正 ---
  const dated = expanded.map((occ) => {
    let startsOn = occ.starts_on ?? input.fallbackPeriod?.startsOn ?? null;
    let endsOn = occ.ends_on ?? input.fallbackPeriod?.endsOn ?? null;

    // 空文字は null 扱い (捏造せず「不明」として通す)
    if (typeof startsOn === 'string' && trimLabel(startsOn).length === 0) startsOn = null;
    if (typeof endsOn === 'string' && trimLabel(endsOn).length === 0) endsOn = null;

    if (startsOn && endsOn) {
      const { endsOn: fixed, corrected } = correctYearWrap(startsOn, endsOn);
      if (corrected) {
        warnings.push(
          `ends_on (${endsOn}) が starts_on (${startsOn}) より前だったため、` +
            `終了年の省略とみなして ${fixed} へ補正しました (年跨ぎ開催)。`
        );
        endsOn = fixed;
      } else if (endsOn < startsOn) {
        warnings.push(
          `ends_on (${endsOn}) が starts_on (${startsOn}) より前ですが、` +
            `年跨ぎ補正では解消しませんでした。抽出値の誤りの可能性があります。`
        );
      }
    }

    return { ...occ, starts_on: startsOn, ends_on: endsOn };
  });

  // --- 重複除去 ---
  // 同一会場でも**期間が違えば別開催**として残す (前期/後期を潰さないため)。
  const seen = new Set<string>();
  const deduped: EventDataOccurrence[] = [];
  for (const occ of dated) {
    const key = `${occ.venue_label ?? ''} ${occ.starts_on ?? ''} ${occ.ends_on ?? ''}`;
    if (seen.has(key)) {
      warnings.push(`重複した開催を除去しました: ${occ.venue_label ?? '(会場名なし)'}`);
      continue;
    }
    seen.add(key);
    deduped.push(occ);
  }

  // --- 会場数の cross-check (warn のみ、throw しない) ---
  const prefectureCount = input.prefectures?.length ?? 0;
  if (prefectureCount > 0 && deduped.length > 0 && deduped.length < prefectureCount) {
    warnings.push(
      `開催都道府県が ${prefectureCount} 件あるのに occurrences は ${deduped.length} 件です。` +
        `会場の取りこぼしの可能性があります。`
    );
  }

  // --- 日付欠落の可視化 (捏造させないための代償として、必ずログに残す) ---
  const undatedCount = deduped.filter((o) => !o.starts_on).length;
  if (undatedCount > 0) {
    warnings.push(
      `starts_on が未確定の開催が ${undatedCount} 件あります。` +
        `日付未発表 (A-1-c パターン 1/2) なら正常な状態です。`
    );
  }

  return { occurrences: deduped, warnings };
}
