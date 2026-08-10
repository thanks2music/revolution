/**
 * Event Type Heading Label Utility
 *
 * @description
 * イベント種別を**見出しに出すときの短縮表記**へ解決する純粋関数。
 *
 * 代表会場名が決まらない多ブランド開催では、H2 が
 * `## {作品名} {種別} in {都市}` の形になる (S1-d Phase 3 決定表 Step 5)。
 * そこに入れる「種別」を解決するのが本モジュール。
 *
 * ## なぜ「カフェ」をハードコードしないか
 *
 * 抽出結果の種別名は `コラボカフェ` で、見出しに出したいのは `カフェ` である。
 * ここで `'カフェ'` を定数で埋めると、**pop-up-store や原画展の記事にも
 * 「カフェ」と書く**ことになる。
 *
 * `revolution-article-meta.md` §4.3 が同じ趣旨を述べている:
 *
 * > テイクアウトのみの企画に `-cafe` を付けると**席がないのにカフェと名乗る**
 * > ことになる。種別は `eventType` が独立に持つ。
 *
 * これは `event_slug` についての規定だが、読者が最初に見る H2 見出しには
 * より直接あてはまる (理想 doc §2 中心軸 (a) 事実の正確性)。
 *
 * ## 解決の順序
 *
 * ```
 * 1. 種別名 → slug        (event_types、多対一)
 * 2. slug   → 見出し表記   (heading_labels、一対一)
 * 3. 未定義なら種別名をそのまま返す (フォールバック)
 * ```
 *
 * **3 で「カフェ」を既定値にしない。** 未知の種別は抽出された名前をそのまま出すのが
 * 最も安全で、少なくとも嘘にはならない。
 *
 * @module lib/utils/event-type-heading-label
 * @see lib/utils/store-derivation.ts (本モジュールの出力を `eventTypeLabel` として受け取る)
 * @see revolution-templates/ai-writer/config/event-type-slugs.yaml (`heading_labels`)
 */

/** `event-type-slugs.yaml` のうち、本モジュールが必要とする部分だけの形。 */
export interface EventTypeHeadingLabelInput {
  /** 抽出された種別名 (例: `コラボカフェ`) */
  eventTypeName?: string | null;
  /** `event_types`: 種別名 → slug (多対一) */
  eventTypes?: Record<string, string> | null;
  /** `heading_labels`: slug → 見出し表記 (一対一) */
  headingLabels?: Record<string, string> | null;
}

/**
 * 種別名を見出し用の短縮表記へ解決する。
 *
 * 純粋関数。解決できなければ入力の種別名をそのまま返し、空なら空文字を返す
 * (throw しない = observability 規約)。
 *
 * @example
 * resolveEventTypeHeadingLabel({
 *   eventTypeName: 'コラボカフェ',
 *   eventTypes: { コラボカフェ: 'collabo-cafe' },
 *   headingLabels: { 'collabo-cafe': 'カフェ' },
 * })
 * // → 'カフェ'
 *
 * @example
 * // heading_labels に無い種別は、抽出された名前をそのまま返す
 * resolveEventTypeHeadingLabel({
 *   eventTypeName: 'ポップアップストア',
 *   eventTypes: { ポップアップストア: 'pop-up-store' },
 *   headingLabels: { 'collabo-cafe': 'カフェ' },
 * })
 * // → 'ポップアップストア' ('カフェ' ではない)
 */
export function resolveEventTypeHeadingLabel(input: EventTypeHeadingLabelInput): string {
  const name = (input.eventTypeName ?? '').trim();
  if (name.length === 0) return '';

  const slug = input.eventTypes?.[name];
  if (typeof slug !== 'string' || slug.length === 0) return name;

  const label = input.headingLabels?.[slug];
  if (typeof label !== 'string' || label.trim().length === 0) return name;

  return label.trim();
}
