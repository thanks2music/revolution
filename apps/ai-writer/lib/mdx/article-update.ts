/**
 * 公開中の記事の更新 (`pnpm debug:mdx --update <post_id>`) で、既存の記事から引き継ぐ値と、更新の PR の名前。
 *
 * 記事は同じ post_id・同じ URL のまま全体を作り直す (BOSS 決定 2026-10-13)。引き継ぐのは:
 * - post_id / slug (記事の URL)、year (画像のフォルダ `{event_type}/{year}/{post_id}`)、event_type と work_slug (記事のパス)
 * - title (作り直さない。BOSS 決定 2026-10-16)
 * - date (公開日。更新日時は updated に書く)
 * - official_url (作り直しの入力。同じ公式サイトから作る)
 */
import type { EventData } from '@revolution/schemas/mdx-frontmatter';
import { parseFrontmatter } from './parse-frontmatter';

export interface ExistingArticleFields {
  postId: string;
  year: number;
  eventType: string;
  workSlug: string;
  title: string;
  date: string;
  officialUrl: string;
  /** event_data の企画を決める項目 (既存の記事にある項目だけ) */
  eventKeys: EventKeys;
}

/**
 * event_data のうち、取り込みで企画と作品を決める項目 (`apps/frontend/lib/ingest/plan-ingest.ts`)。
 * 抽出の LLM が実行ごとに揺れる (2026-10-19、ヒロアカで title_slugs が my-hero-academia → boku-no-hero-academia) ので、
 * 記事の更新では既存の記事の値を引き継ぐ (BOSS 決定 2026-10-19)。会場ごとの日程 (occurrences) は作り直す
 */
export const EVENT_KEY_NAMES = ['event_slug', 'event_name', 'title_slugs', 'primary_category_slug'] as const;

export type EventKeys = Partial<Pick<EventData, (typeof EVENT_KEY_NAMES)[number]>>;

/** 引き継ぐ値の frontmatter のキー */
const INHERITED_KEYS = ['post_id', 'year', 'event_type', 'work_slug', 'title', 'date', 'official_url'] as const;

/**
 * 既存の記事の frontmatter から、引き継ぐ値を読む。
 *
 * @throws frontmatter が無い、または引き継ぐ値が欠けているとき (推測で埋めない)
 */
export function readExistingArticleFields(content: string): ExistingArticleFields {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    throw new Error('記事に frontmatter がありません');
  }

  const missing = INHERITED_KEYS.filter((key) => {
    const value = frontmatter[key];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) {
    throw new Error(`記事の frontmatter に ${missing.join(', ')} がありません`);
  }
  if (!Number.isInteger(frontmatter.year)) {
    throw new Error(`記事の frontmatter の year が整数ではありません: ${String(frontmatter.year)}`);
  }
  const notString = INHERITED_KEYS.filter((key) => key !== 'year' && typeof frontmatter[key] !== 'string');
  if (notString.length > 0) {
    throw new Error(`記事の frontmatter の ${notString.join(', ')} が文字列ではありません`);
  }

  return {
    postId: frontmatter.post_id,
    year: frontmatter.year,
    eventType: frontmatter.event_type,
    workSlug: frontmatter.work_slug,
    title: frontmatter.title,
    date: frontmatter.date,
    officialUrl: frontmatter.official_url!,
    eventKeys: readEventKeys(frontmatter.event_data),
  };
}

function readEventKeys(eventData: Partial<EventData> | undefined): EventKeys {
  const keys: EventKeys = {};
  if (!eventData) return keys;
  if (eventData.event_slug) keys.event_slug = eventData.event_slug;
  if (eventData.event_name) keys.event_name = eventData.event_name;
  if (eventData.title_slugs && eventData.title_slugs.length > 0) keys.title_slugs = [...eventData.title_slugs];
  if (eventData.primary_category_slug) keys.primary_category_slug = eventData.primary_category_slug;
  return keys;
}

/**
 * 作り直した event_data に、既存の記事の企画の項目を戻す。既存の記事に無い項目は作り直した値のまま。
 * 値が違った項目を `changes` に返す (ログと PR 本文に出す)。作り直した event_data が無ければそのまま (undefined)
 */
export function inheritEventKeys(
  eventData: EventData | undefined,
  keys: EventKeys,
): { eventData: EventData | undefined; changes: string[] } {
  if (!eventData) return { eventData, changes: [] };
  const changes: string[] = [];
  const merged: EventData = { ...eventData };
  for (const name of EVENT_KEY_NAMES) {
    const kept = keys[name];
    if (kept === undefined) continue;
    const show = (value: unknown) => (Array.isArray(value) ? value.join(', ') : String(value ?? '(なし)'));
    if (show(eventData[name]) !== show(kept)) {
      changes.push(`${name}: ${show(eventData[name])} → ${show(kept)} (既存の記事の値に戻した)`);
    }
    Object.assign(merged, { [name]: Array.isArray(kept) ? [...kept] : kept });
  }
  return { eventData: merged, changes };
}

/**
 * 作り直した記事の slug が既存の記事と違う項目 (違えば更新を止める。記事のパスと URL が変わるため)
 */
export function findSlugChanges(
  existing: Pick<ExistingArticleFields, 'workSlug' | 'eventType'>,
  resolved: { workSlug: string; eventType: string },
): string[] {
  const changes: string[] = [];
  if (resolved.workSlug !== existing.workSlug) {
    changes.push(`work_slug: ${existing.workSlug} → ${resolved.workSlug}`);
  }
  if (resolved.eventType !== existing.eventType) {
    changes.push(`event_type: ${existing.eventType} → ${resolved.eventType}`);
  }
  return changes;
}

/** `YYYYMMDD-HHmmss` (UTC) */
function compactUtc(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, '').replace(/-|:/g, '').replace('T', '-');
}

/** 更新の PR のブランチ (同じ記事を何度更新しても重ならないよう日時を付ける) */
export function updateBranchName(eventType: string, postId: string, now: Date): string {
  return `ai-writer/update-${eventType}-${postId}-${compactUtc(now)}`;
}

export function updatePrTitle(eventType: string, postId: string): string {
  return `♻️ Update article (AI Writer): ${eventType}/${postId}`;
}
