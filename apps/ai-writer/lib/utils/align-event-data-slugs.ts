/**
 * event_data の作品の slug を、辞書の slug にそろえる (Layer 1、純粋関数)。
 *
 * 抽出の LLM は `title_slugs` と `event_slug` を実行ごとに違う綴りで書く (例: 辞書の slug ではなく
 * 作品名のローマ字読み)。取り込みは `events.slug` と作品の slug の完全一致で企画と作品を決めるので、
 * 綴りが揺れると作品に結び付かないか、同じ企画が別の企画として入る。
 *
 * 決め方 (2026-11-05):
 * 1. `title_slugs` の各要素を、辞書の slug か辞書の slug の形の別名から、辞書の slug に直す
 * 2. `works[]` の作品名を辞書で引き、まだ無い辞書の slug と、辞書で引けない要素が 1 つずつなら置き換える。
 *    2 つ以上ある、または辞書に無い作品の slug がその要素かもしれないときは、対応が決まらないので
 *    置き換えず、警告を返す (推測で埋めない)
 * 3. 作品が 1 つで、作品名が辞書に無く、記事の work_slug が辞書の slug なら、それを使う
 * 4. 主作品 (is_primary) の辞書の slug を先頭に移す
 * 5. `event_slug` の作品の部分 (区切り単位) を、置き換えた旧い slug と、作品の slug の形の別名から
 *    辞書の slug に差し替える。それ以外の部分は LLM の値のまま
 *
 * 辞書に無い作品の slug は LLM の値のまま残す (取り込みの人手キューで辞書に足す)。
 */
import type { EventData } from '@revolution/schemas/mdx-frontmatter';
import { EVENT_SLUG_REGEX } from '@revolution/schemas/event';

import { escapeRegExp } from './escape-regexp';

export interface WorkLike {
  title: string;
  is_primary?: boolean;
}

export interface TitleDictionary {
  /** 日本語の作品名 → 辞書の slug (辞書に無ければ null) */
  slugOfTitle: (title: string) => string | null;
  /** slug → 辞書の slug (辞書の slug そのものか、slug の形の別名。どちらでもなければ null) */
  canonicalOfSlug: (slug: string) => string | null;
  /** 辞書の slug → その作品の slug の形の別名 */
  slugAliasesOf: (slug: string) => string[];
}

export interface AlignEventDataSlugsResult {
  eventData: EventData;
  /** 変えた内容 (ログ用) */
  changes: string[];
  /** 置き換えなかった理由 (ログ用) */
  warnings: string[];
  /** 辞書に無い作品の名前 */
  unknownWorks: string[];
}

/**
 * event_slug の差し替えに使う辞書の別名の最小の長さ。`86` や `sk` のような短い別名は、作品の部分では
 * ない区切り (数字・略号) にも当たりうるので使わない。LLM がこの記事で書いた綴り (`replaced`) は長さを問わず使う
 */
const MIN_ALIAS_LENGTH_FOR_EVENT_SLUG = 4;

/**
 * slug を区切り (ハイフン) 単位で差し替える。1 回の走査で行うので、差し替えた後の文字列に
 * 別の綴りがもう一度当たることはない。綴りが重なるときは長いものを優先する。
 *
 * `variants` には辞書の slug そのもの (自分自身への差し替え) も入れておく。辞書の slug がすでに
 * 入っていればそちらが先に当たって消費されるので、その一部分である短い別名には当たらない
 * (例: 辞書の slug `grand-work-dreaming` の別名 `grand-work` が、`grand-work-dreaming-cafe` の中に再び当たらない)。
 */
function replaceSegments(value: string, variants: ReadonlyMap<string, string>): string {
  const froms = [...variants.keys()].sort((a, b) => b.length - a.length);
  if (froms.length === 0) return value;
  const pattern = new RegExp(`(^|-)(${froms.map(escapeRegExp).join('|')})(?=-|$)`, 'g');
  return value.replace(pattern, (_, head: string, from: string) => `${head}${variants.get(from)}`);
}

export function alignEventDataSlugs(params: {
  eventData: EventData;
  works: readonly WorkLike[];
  workSlug: string;
  dictionary: TitleDictionary;
}): AlignEventDataSlugsResult {
  const { eventData, works, workSlug, dictionary } = params;
  const changes: string[] = [];
  const warnings: string[] = [];
  const replaced = new Map<string, string>(); // LLM の slug → 辞書の slug
  const isDictionarySlug = (slug: string) => dictionary.canonicalOfSlug(slug) === slug;
  // 作品が 1 つのときだけ、記事の work_slug (辞書の slug なら) をその作品の slug とみなす
  const singleWorkSlug = works.length === 1 && isDictionarySlug(workSlug) ? workSlug : null;

  // 1. 辞書の slug と slug の形の別名を、辞書の slug に直す
  const slugs = eventData.title_slugs.map((slug) => {
    const canonical = dictionary.canonicalOfSlug(slug);
    if (canonical === null || canonical === slug) return slug;
    replaced.set(slug, canonical);
    return canonical;
  });

  // 2. works[] の作品名を辞書で引き、1 対 1 で決まる分だけ置き換える
  const dictionaryOfWork = works.map((work) => ({ work, slug: dictionary.slugOfTitle(work.title) }));
  const unknownWorks = dictionaryOfWork.filter((x) => x.slug === null).map((x) => x.work.title);
  const missing = [...new Set(dictionaryOfWork.map((x) => x.slug).filter((s): s is string => s !== null))].filter(
    (slug) => !slugs.includes(slug),
  );
  const unresolved = slugs.flatMap((slug, i) => (isDictionarySlug(slug) ? [] : [i]));
  // 辞書に無い作品の slug が、辞書で引けない要素のどれかかもしれない。辞書に無い作品の数が、
  // どの作品にも当たらない辞書の slug の数 (その作品の slug と読める) より多いときは、1 対 1 に決まらない
  const knownSlugs = new Set(dictionaryOfWork.map((x) => x.slug));
  const unclaimedDictionarySlugs = slugs.filter((slug) => isDictionarySlug(slug) && !knownSlugs.has(slug)).length;
  const determined = unknownWorks.length <= unclaimedDictionarySlugs;
  if (missing.length === 1 && unresolved.length === 1 && determined) {
    const i = unresolved[0];
    replaced.set(slugs[i], missing[0]);
    slugs[i] = missing[0];
  } else if (missing.length > 0 && unresolved.length > 0) {
    warnings.push(
      `title_slugs の対応が決まらないため置き換えない: 辞書の slug ${missing.join(', ')} / 辞書に無い slug ${unresolved.map((i) => slugs[i]).join(', ')}`,
    );
  }

  // 3. 作品が 1 つで作品名が辞書に無いときは、記事の work_slug (辞書の slug なら) を使う
  if (singleWorkSlug !== null && dictionaryOfWork[0].slug === null && slugs.length === 1 && !isDictionarySlug(slugs[0])) {
    replaced.set(slugs[0], singleWorkSlug);
    slugs[0] = singleWorkSlug;
  }

  // 4. 主作品の辞書の slug を先頭に移し、重複を除く
  const primary = works.find((work) => work.is_primary) ?? works[0];
  const primarySlug = (primary && dictionary.slugOfTitle(primary.title)) ?? singleWorkSlug;
  const ordered = [...new Set(primarySlug !== null && slugs.includes(primarySlug) ? [primarySlug, ...slugs] : slugs)];

  if (ordered.join(',') !== eventData.title_slugs.join(',')) {
    changes.push(`title_slugs: ${eventData.title_slugs.join(', ')} → ${ordered.join(', ')}`);
  }

  // 5. event_slug の作品の部分を差し替える
  let eventSlug = eventData.event_slug;
  if (eventSlug !== undefined) {
    const dictionarySlugs = ordered.filter(isDictionarySlug);
    const variants = new Map<string, string>(dictionarySlugs.map((slug) => [slug, slug]));
    for (const [from, to] of replaced) if (!variants.has(from)) variants.set(from, to);
    for (const slug of dictionarySlugs) {
      for (const alias of dictionary.slugAliasesOf(slug)) {
        // 短い別名は使わない (作品の部分ではない区切りに当たりうる)
        if (alias.length < MIN_ALIAS_LENGTH_FOR_EVENT_SLUG) continue;
        // ほかの作品の辞書の slug と同じ別名は使わない (その作品の部分を書き換えてしまう)
        if (!variants.has(alias) && !isDictionarySlug(alias)) variants.set(alias, slug);
      }
    }
    const next = replaceSegments(eventSlug, variants);
    if (next !== eventSlug) {
      if (EVENT_SLUG_REGEX.test(next)) {
        changes.push(`event_slug: ${eventSlug} → ${next}`);
        eventSlug = next;
      } else {
        warnings.push(`event_slug の差し替えが slug の形にならないため戻した: ${next}`);
      }
    }
  }

  return {
    eventData: {
      ...eventData,
      title_slugs: ordered,
      ...(eventSlug === undefined ? {} : { event_slug: eventSlug }),
    },
    changes,
    warnings,
    unknownWorks,
  };
}
