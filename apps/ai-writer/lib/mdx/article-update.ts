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

/**
 * 既存の記事の event_data から、企画を決める項目を読む (空の値と、配列でない title_slugs は読まない)。
 * title_slugs だけここで項目ごと落とすのは、配列でない値 (古い書き方の 1 つの文字列) をそのまま戻すと、
 * 1 文字ずつの配列に化けたり、スキーマで全項目の引き継ぎが止まったりするため。ほかの項目の形はスキーマで確かめる
 */
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
  /** 引き継いだ項目の名前 */
  kept: string[];
  /** 作り直した値と違ったので、既存の記事の値に戻した項目 */
  changes: string[];
  /** 引き継げなかった項目があるとき、その理由 (形式に合わない値、作り直した event_data が無いなど) */
  rejected: string | null;
}

/** 引き継ぎの結果のうち、ログと PR 本文に出す部分 */
export type EventKeysReport = Omit<InheritedEventKeys, 'eventData'>;

/** 表示するための文字列 */
function show(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(なし)';
  return value === undefined || value === null || value === '' ? '(なし)' : String(value);
}

/**
 * 作り直した event_data に、既存の記事の企画の項目を戻す。既存の記事に無い項目は作り直した値のまま。
 * 項目ごとに今のスキーマ (`EventDataSchema`) の形を確かめ、合う項目だけ戻す (古い形式の 1 項目のために、ほかの項目まで
 * 揺れた値にしないため)。主カテゴリを戻したとき、それが補助のカテゴリにも入っていれば補助から外す (同じカテゴリを 2 回登録しないため)。
 * 返すのは組み立てた値 (スキーマで解析した値ではない。occurrences などを作り直した値のまま変えないため)。
 * 作り直した event_data が無ければそのまま (undefined。会場の数が 0 になり、減少として止まる)
 */
export function inheritEventKeys(eventData: EventData | undefined, keys: EventKeys): InheritedEventKeys {
  const present = EVENT_KEY_NAMES.filter((name) => keys[name] !== undefined);
  if (present.length === 0) return { eventData, kept: [], changes: [], rejected: null };
  if (!eventData) {
    return { eventData, kept: [], changes: [], rejected: '作り直した event_data が無い (会場の数が 0 になり、減少として止まる)' };
  }

  const kept = present.filter((name) => EventDataSchema.shape[name].safeParse(keys[name]).success);
  const invalid = present.filter((name) => !kept.includes(name));
  const merged: EventData = { ...eventData };
  const changes: string[] = [];
  for (const name of kept) {
    if (JSON.stringify(eventData[name] ?? null) !== JSON.stringify(keys[name])) {
      changes.push(`${name}: ${show(eventData[name])} → ${show(keys[name])} (既存の記事の値に戻した)`);
    }
    Object.assign(merged, { [name]: keys[name] });
  }
  if (merged.supplementary_category_slugs?.includes(merged.primary_category_slug)) {
    merged.supplementary_category_slugs = merged.supplementary_category_slugs.filter(
      (slug) => slug !== merged.primary_category_slug,
    );
  }

  // 作り直した eventData は parseAndNormalizeEventData で同じスキーマを通っているので、ここで失敗するのは引き継いだ値が原因のときだけ
  if (!EventDataSchema.safeParse(merged).success) {
    return { eventData, kept: [], changes: [], rejected: '引き継ぐと event_data 全体が今の形式に合わなくなる' };
  }
  const rejected = invalid.length > 0 ? `既存の記事の値が今の形式に合わない項目は引き継がなかった (${invalid.join(', ')})` : null;
  return { eventData: merged, kept, changes, rejected };
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

/** 更新の PR 本文の「企画を決める項目」の行 */
export function describeEventKeys(report: EventKeysReport): string {
  const lines: string[] = [];
  if (report.kept.length === 0) {
    if (!report.rejected) lines.push('- 既存の記事にこれらの項目が無いため、作り直した値を使っている');
  } else {
    lines.push(`- 引き継いだ項目: ${report.kept.join(' / ')}`);
    if (report.changes.length === 0) lines.push('- 引き継いだ項目は、作り直した値も既存の記事と同じだった');
    else lines.push(...report.changes.map((change) => `- ${change}`));
  }
  if (report.rejected) lines.push(`- ⚠️ ${report.rejected}。その項目は作り直した値を使っている (差分で確かめる)`);
  return lines.join('\n');
}
