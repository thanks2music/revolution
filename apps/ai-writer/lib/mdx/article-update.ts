/**
 * 公開中の記事の更新 (`pnpm debug:mdx --update <post_id>`) で、既存の記事から引き継ぐ値と、更新の PR の名前。
 *
 * 記事は同じ post_id・同じ URL のまま全体を作り直す (BOSS 決定 2026-10-13)。引き継ぐのは:
 * - post_id / slug (記事の URL)、year (画像のフォルダ `{event_type}/{year}/{post_id}`)、event_type と work_slug (記事のパス)
 * - title (作り直さない。BOSS 決定 2026-10-16)
 * - date (公開日。更新日時は updated に書く)
 * - official_url (作り直しの入力。同じ公式サイトから作る)
 */
import { parseFrontmatter } from './parse-frontmatter';

export interface ExistingArticleFields {
  postId: string;
  year: number;
  eventType: string;
  workSlug: string;
  title: string;
  date: string;
  officialUrl: string;
}

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

  const fields = {
    postId: frontmatter.post_id,
    year: frontmatter.year,
    eventType: frontmatter.event_type,
    workSlug: frontmatter.work_slug,
    title: frontmatter.title,
    date: frontmatter.date,
    officialUrl: frontmatter.official_url,
  };
  const missing = Object.entries({
    post_id: fields.postId,
    year: fields.year,
    event_type: fields.eventType,
    work_slug: fields.workSlug,
    title: fields.title,
    date: fields.date,
    official_url: fields.officialUrl,
  })
    .filter(([, value]) => value === undefined || value === null || value === '')
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`記事の frontmatter に ${missing.join(', ')} がありません`);
  }
  if (typeof fields.year !== 'number' || !Number.isInteger(fields.year)) {
    throw new Error(`記事の frontmatter の year が整数ではありません: ${String(fields.year)}`);
  }

  return fields as ExistingArticleFields;
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
