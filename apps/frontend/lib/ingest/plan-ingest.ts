/**
 * occurrence 取り込みの実行計画ビルダー (Layer 1 純粋関数)
 *
 * 記事の `event_data` 配列と「既知マスタのスナップショット」を受け取り、
 * **upsert すべき行と人手キューへ送る項目**を算出する。DB へは書かない
 * (書き込みは `execute-ingest.ts`)。
 *
 * 設計の正本: `one-more-time/docs/event-review-data-model.md` §8.2
 * (品質ゲート表 + 案 B 採番規約、2026-08-20 BOSS 確定)。
 *
 * ゲート一覧 (テストと 1:1 対応):
 * - G1: `event_name` / `event_slug` 欠落 → 記事ごと保留 → キュー
 * - G1c: `primary_category_slug` が categories に不在 → 記事ごと保留 → キュー
 *   (`events.primary_category_id` が NOT NULL のため events 行を作れない)
 * - G2: 決定論ガード — `venue_label` が null / `event_name` と完全一致 /
 *   「、」連結痕 → その occurrence をスキップ → キュー
 * - G3: 新規 title (slug 直接一致も alias 正規化一致もしない) →
 *   event / occurrence は作るが `verified = false` + キュー
 * - G4: venue 解決不能 (venue_aliases に当たらない) → **occurrence を作らない** →
 *   キュー (案 B: `venues.slug` が無く slug を採番できない)
 * - G5: 全 title + venue 解決 → `verified = true`
 * - G6: `starts_on = null` → 正常系として作る (`unscheduled`)
 * - G7: 既存 `(event_slug, slug)` と期間違い → `-YYYYMM` (starts_on 由来) で別行
 * - G8: doc の「衝突かつ starts_on = null は作らない」は、本実装では
 *   **到達不能** — starts_on = null の入力は期間違いを立証できないため
 *   既存行への update (日付は上書きしない) に吸収される。日付が判明した
 *   続報の時点で G7 が別行化するため、結果は doc の意図 (日付なしの
 *   重複行を作らない) と一致する
 *
 * 冪等の同定規則 (再実行・続報で重複を作らない):
 * - 既存行の `starts_on` が incoming と一致 → **update** (同一開催の再取り込み)
 * - 既存が null で incoming が非 null → **update** (第一報 → 続報の日付確定)
 * - incoming が null で既存が非 null → **update だが日付は上書きしない**
 *   (既に確定した日付を第一報の再取り込みで消さない)
 * - 両方非 null で不一致 → 再演 = G7 の衝突扱い
 */
import type { EventData } from '@revolution/schemas/mdx-frontmatter';

import { normalizeAlias } from './normalize-alias';

export interface ArticleEventData {
  /** 記事の post_id (ULID)。キューの追跡用 */
  articleSlug: string;
  eventData: EventData;
}

/** 既知マスタのスナップショット。executor が DB から取得して渡す。 */
export interface MasterSnapshot {
  /** categories.slug → id (23 件 seed 済み) */
  categoryIdBySlug: ReadonlyMap<string, number>;
  /** titles.slug → id */
  titleIdBySlug: ReadonlyMap<string, number>;
  /** title_aliases.alias (正規化済み) → title_id */
  titleIdByAlias: ReadonlyMap<string, number>;
  /** venues.slug → id */
  venueIdBySlug: ReadonlyMap<string, number>;
  /** venue_aliases.alias (正規化済み) → { id, slug } */
  venueByAlias: ReadonlyMap<string, { id: number; slug: string }>;
  /** 既存 occurrences (events.slug でキー)。冪等判定と衝突判定に使う */
  existingOccurrences: ReadonlyMap<
    string,
    ReadonlyArray<{ slug: string; startsOn: string | null; endsOn: string | null }>
  >;
}

export type QueueReason =
  | 'missing_event_identity' // G1
  | 'unknown_primary_category' // G1c
  | 'venue_label_missing' // G2
  | 'venue_label_equals_event_name' // G2
  | 'venue_label_concatenated' // G2
  | 'unknown_title' // G3
  | 'unknown_venue' // G4
  | 'slug_conflict_unresolvable' // G7 の接尾辞まで衝突
  | 'unknown_supplementary_category' // 非ブロッキング (event_categories に張れないだけ)
  | 'event_name_mismatch'; // 同一 event_slug で別 name (非ブロッキング、先勝ち)

export interface QueueItem {
  articleSlug: string;
  eventSlug: string | null;
  reason: QueueReason;
  /** 人が読んで判断するための対象値 (venue_label / title_slug 等) */
  detail: string;
}

export interface PlannedEvent {
  slug: string;
  name: string;
  primaryCategoryId: number;
  officialUrl: string | null;
  /** この event を供給した記事 (キュー追跡・レポート用) */
  articleSlugs: string[];
}

export interface PlannedOccurrence {
  eventSlug: string;
  slug: string;
  venueId: number;
  venueLabel: string;
  startsOn: string | null;
  endsOn: string | null;
  // official_url は occurrences に列が無い (events.official_url が持つ) ため計画に含めない
  verified: boolean;
  action: 'insert' | 'update';
}

export interface IngestPlan {
  events: PlannedEvent[];
  /** (eventSlug, titleId)。executor が event id 解決後に upsert する */
  eventTitles: Array<{ eventSlug: string; titleId: number }>;
  /** supplementary categories → event_categories */
  eventCategories: Array<{ eventSlug: string; categoryId: number }>;
  occurrences: PlannedOccurrence[];
  queue: QueueItem[];
  stats: {
    articles: number;
    articlesSkipped: number;
    occurrencesPlanned: number;
    occurrencesQueued: number;
  };
}

/** starts_on (YYYY-MM-DD) → 年月接尾辞 (YYYYMM)。G7 用 */
function yearMonthSuffix(startsOn: string): string {
  return startsOn.slice(0, 7).replace('-', '');
}

export function planIngest(
  articles: ArticleEventData[],
  snapshot: MasterSnapshot,
): IngestPlan {
  const plan: IngestPlan = {
    events: [],
    eventTitles: [],
    eventCategories: [],
    occurrences: [],
    queue: [],
    stats: { articles: articles.length, articlesSkipped: 0, occurrencesPlanned: 0, occurrencesQueued: 0 },
  };

  const eventBySlug = new Map<string, PlannedEvent>();
  const eventTitlePairs = new Set<string>();
  const eventCategoryPairs = new Set<string>();
  // 冪等判定は「既存 DB 行 + 本 run で計画済みの行」の合算に対して行う
  const occurrenceIndex = new Map<
    string,
    Array<{ slug: string; startsOn: string | null; endsOn: string | null }>
  >();
  for (const [eventSlug, rows] of snapshot.existingOccurrences) {
    occurrenceIndex.set(eventSlug, [...rows]);
  }

  for (const { articleSlug, eventData } of articles) {
    // --- G1: event の同一性が無い記事は取り込めない ---
    const eventSlug = eventData.event_slug;
    const eventName = eventData.event_name;
    if (!eventSlug || !eventName) {
      plan.queue.push({
        articleSlug,
        eventSlug: eventSlug ?? null,
        reason: 'missing_event_identity',
        detail: `event_slug=${eventSlug ?? 'null'} / event_name=${eventName ?? 'null'}`,
      });
      plan.stats.articlesSkipped += 1;
      continue;
    }

    // --- G1c: primary category が引けないと events 行を作れない ---
    const primaryCategoryId = snapshot.categoryIdBySlug.get(eventData.primary_category_slug);
    if (primaryCategoryId === undefined) {
      plan.queue.push({
        articleSlug,
        eventSlug,
        reason: 'unknown_primary_category',
        detail: eventData.primary_category_slug,
      });
      plan.stats.articlesSkipped += 1;
      continue;
    }

    const officialUrl =
      eventData.occurrences?.find((o) => o.official_url !== null)?.official_url ?? null;

    // --- events (同一 event_slug は先勝ちでマージ。第一報 → 続報の複数記事対応) ---
    const existingEvent = eventBySlug.get(eventSlug);
    if (existingEvent === undefined) {
      const planned: PlannedEvent = {
        slug: eventSlug,
        name: eventName,
        primaryCategoryId,
        officialUrl,
        articleSlugs: [articleSlug],
      };
      eventBySlug.set(eventSlug, planned);
      plan.events.push(planned);
    } else {
      existingEvent.articleSlugs.push(articleSlug);
      existingEvent.officialUrl ??= officialUrl;
      if (existingEvent.name !== eventName) {
        plan.queue.push({
          articleSlug,
          eventSlug,
          reason: 'event_name_mismatch',
          detail: `"${existingEvent.name}" vs "${eventName}" (先勝ち)`,
        });
      }
    }

    // --- G3: titles の解決 (slug 直接一致 → alias 正規化一致 → 新規) ---
    let allTitlesResolved = true;
    for (const titleSlug of eventData.title_slugs) {
      const titleId =
        snapshot.titleIdBySlug.get(titleSlug) ??
        snapshot.titleIdByAlias.get(normalizeAlias(titleSlug));
      if (titleId === undefined) {
        allTitlesResolved = false;
        plan.queue.push({ articleSlug, eventSlug, reason: 'unknown_title', detail: titleSlug });
        continue;
      }
      const pairKey = `${eventSlug} ${titleId}`;
      if (!eventTitlePairs.has(pairKey)) {
        eventTitlePairs.add(pairKey);
        plan.eventTitles.push({ eventSlug, titleId });
      }
    }

    // --- supplementary categories (非ブロッキング) ---
    for (const categorySlug of eventData.supplementary_category_slugs ?? []) {
      const categoryId = snapshot.categoryIdBySlug.get(categorySlug);
      if (categoryId === undefined) {
        plan.queue.push({
          articleSlug,
          eventSlug,
          reason: 'unknown_supplementary_category',
          detail: categorySlug,
        });
        continue;
      }
      const pairKey = `${eventSlug} ${categoryId}`;
      if (!eventCategoryPairs.has(pairKey)) {
        eventCategoryPairs.add(pairKey);
        plan.eventCategories.push({ eventSlug, categoryId });
      }
    }

    // --- occurrences ---
    for (const occurrence of eventData.occurrences ?? []) {
      const queued = (reason: QueueReason, detail: string): void => {
        plan.queue.push({ articleSlug, eventSlug, reason, detail });
        plan.stats.occurrencesQueued += 1;
      };

      // G2: 決定論ガード
      const label = occurrence.venue_label;
      if (label === null || label.trim() === '') {
        queued('venue_label_missing', 'venue_label=null');
        continue;
      }
      if (label === eventName) {
        queued('venue_label_equals_event_name', label);
        continue;
      }
      if (label.includes('、')) {
        queued('venue_label_concatenated', label);
        continue;
      }

      // 案 B: venue の解決 (venue_slug 直接 → venue_label 正規化 → 新規 = G4)
      let venue: { id: number; slug: string } | undefined;
      if (occurrence.venue_slug !== null) {
        const id = snapshot.venueIdBySlug.get(occurrence.venue_slug);
        if (id !== undefined) venue = { id, slug: occurrence.venue_slug };
      }
      venue ??= snapshot.venueByAlias.get(normalizeAlias(label));
      if (venue === undefined) {
        queued('unknown_venue', label);
        continue;
      }

      // 冪等の同定 + G7/G8 の衝突解決
      const rows = occurrenceIndex.get(eventSlug) ?? [];
      occurrenceIndex.set(eventSlug, rows);

      const resolveSlug = (
        baseSlug: string,
      ): { slug: string; action: 'insert' | 'update'; existing?: (typeof rows)[number] } | null => {
        const existing = rows.find((r) => r.slug === baseSlug);
        if (existing === undefined) return { slug: baseSlug, action: 'insert' };
        if (existing.startsOn === occurrence.starts_on) return { slug: baseSlug, action: 'update', existing };
        if (existing.startsOn === null && occurrence.starts_on !== null) {
          return { slug: baseSlug, action: 'update', existing }; // 第一報 → 続報
        }
        if (occurrence.starts_on === null) {
          return { slug: baseSlug, action: 'update', existing }; // 日付は上書きしない (下で処理)
        }
        return null; // 両方非 null で不一致 = 再演 (G7)
      };

      let resolved = resolveSlug(venue.slug);
      if (resolved === null) {
        // resolveSlug が null を返すのは両方非 null で不一致のときだけなので、
        // ここでは occurrence.starts_on は必ず非 null (G8 は base slug では発生しない —
        // starts_on = null の入力は期間違いを立証できず、既存行への update に吸収される。
        // 日付が判明した続報の時点で本分岐 = G7 が別行化する)。
        // G7: 年月接尾辞で別行にする
        const suffixed = `${venue.slug}-${yearMonthSuffix(occurrence.starts_on!)}`;
        resolved = resolveSlug(suffixed);
        if (resolved === null) {
          queued('slug_conflict_unresolvable', suffixed);
          continue;
        }
      }

      // incoming null は既存の確定日付を消さない (同定規則)
      const startsOn = occurrence.starts_on ?? resolved.existing?.startsOn ?? null;
      const endsOn = occurrence.ends_on ?? resolved.existing?.endsOn ?? null;

      plan.occurrences.push({
        eventSlug,
        slug: resolved.slug,
        venueId: venue.id,
        venueLabel: label,
        startsOn,
        endsOn,
        verified: allTitlesResolved, // G5 / G3 (venue は解決済みでなければここに来ない)
        action: resolved.action,
      });
      plan.stats.occurrencesPlanned += 1;

      if (resolved.action === 'insert') {
        rows.push({ slug: resolved.slug, startsOn, endsOn });
      }
    }
  }

  return plan;
}
