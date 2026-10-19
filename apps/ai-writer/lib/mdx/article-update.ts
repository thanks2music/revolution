/**
 * 公開中の記事の更新 (`pnpm debug:mdx --update <post_id>`) で、既存の記事から引き継ぐ値と、更新の PR の名前。
 *
 * 記事は同じ post_id・同じ URL のまま全体を作り直す (BOSS 決定 2026-10-13)。引き継ぐのは:
 * - post_id / slug (記事の URL)、year (画像のフォルダ `{event_type}/{year}/{post_id}`)、event_type と work_slug (記事のパス)
 * - title (作り直さない。BOSS 決定 2026-10-16)
 * - date (公開日。更新日時は updated に書く)
 * - official_url (作り直しの入力。同じ公式サイトから作る)
 */
import { EventDataSchema, type EventData } from '@revolution/schemas/mdx-frontmatter';
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

/** 既存の記事の event_data から、企画を決める項目を読む (空の値と、配列でない title_slugs は読まない) */
function readEventKeys(eventData: Partial<EventData> | undefined): EventKeys {
  const keys: Record<string, unknown> = {};
  if (!eventData) return keys;
  for (const name of EVENT_KEY_NAMES) {
    const value = eventData[name];
    if (name === 'title_slugs') {
      if (Array.isArray(value) && value.length > 0) keys[name] = [...value];
    } else if (typeof value === 'string' && value !== '') {
      keys[name] = value;
    }
  }
  return keys as EventKeys;
}

export interface InheritedEventKeys {
  eventData: EventData | undefined;
  /** 引き継いだ項目の名前 (既存の記事にあった項目) */
  kept: string[];
  /** 作り直した値と違ったので、既存の記事の値に戻した項目 */
  changes: string[];
  /** 既存の記事の値が今の形式に合わず、引き継がなかったとき、その理由 */
  rejected: string | null;
}

/** 比べる・表示するための文字列 (配列は順に並べる。title_slugs の先頭は主の作品なので、順も比べる) */
function show(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(なし)';
  return value === undefined || value === null || value === '' ? '(なし)' : String(value);
}

/**
 * 作り直した event_data に、既存の記事の企画の項目を戻す。既存の記事に無い項目は作り直した値のまま。
 * 戻した結果が今のスキーマ (`EventDataSchema`) に合わなければ (古い形式の値など)、引き継がずに作り直した値を使う。
 * 主カテゴリを戻したとき、それが補助のカテゴリにも入っていれば補助から外す (同じカテゴリを 2 回登録しないため)。
 * 作り直した event_data が無ければそのまま (undefined。会場の数の比較で減少として止まる)
 */
export function inheritEventKeys(eventData: EventData | undefined, keys: EventKeys): InheritedEventKeys {
  const kept = EVENT_KEY_NAMES.filter((name) => keys[name] !== undefined);
  if (!eventData || kept.length === 0) return { eventData, kept: [], changes: [], rejected: null };

  const merged: EventData = { ...eventData };
  const changes: string[] = [];
  for (const name of kept) {
    const value = keys[name]!;
    if (show(eventData[name]) !== show(value)) {
      changes.push(`${name}: ${show(eventData[name])} → ${show(value)} (既存の記事の値に戻した)`);
    }
    Object.assign(merged, { [name]: Array.isArray(value) ? [...value] : value });
  }
  if (merged.supplementary_category_slugs?.includes(merged.primary_category_slug)) {
    merged.supplementary_category_slugs = merged.supplementary_category_slugs.filter(
      (slug) => slug !== merged.primary_category_slug,
    );
  }

  const parsed = EventDataSchema.safeParse(merged);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].join(', ');
    return { eventData, kept: [], changes: [], rejected: `既存の記事の値が今の形式に合わない (${fields})` };
  }
  return { eventData: parsed.data, kept, changes, rejected: null };
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
