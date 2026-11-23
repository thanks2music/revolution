/**
 * リード文の連体修飾語 (作品名の前に置く語句) を、抽出の事実から機械的に組み立てる (Layer 1、純粋関数)。
 *
 * 形の文言と選び方の正本は Templates の `01-lead.yaml` の `modifier` (選び方はそのコメント)。
 * ここは選び方の実装で、文言は持たない。公式の情報から分かる事実だけで書き、分からない部分は
 * 推測で埋めずに短い形にする。作品ごとの言い回しは `work-descriptions.yaml` に書いた作品だけ使う。
 */

import type { Gender, GroupKind } from '@revolution/schemas/extraction-response';

import { getAuthorNamesAsArray } from '../utils/author-formatter';

import { fillTemplate } from './section-renderers';

/** `01-lead.yaml` の `modifier` のキー。欠けたら `loadChecked` が名前を挙げて止める */
export const LEAD_MODIFIER_KEYS = [
  'anime_long',
  'anime_short',
  'anime_no_author',
  'original_studio',
  'original',
  'original_creator',
  'studio_work',
  'anime_generic',
  'anime_word',
  'anime_movie_word',
  'source_work',
  'authors_separator',
  'character_owner',
  'character',
  'idol',
  'idol_female',
  'idol_male',
  'youtuber',
  'youtuber_game',
  'youtuber_default',
  'vtuber_default',
  'group_word',
  'film',
  'media_generic',
] as const;

export type LeadModifierFormat = Record<(typeof LEAD_MODIFIER_KEYS)[number], string>;

export interface WorkDescription {
  modifier: string;
  aliases?: string[];
}

export interface CharacterOwner {
  owner: string;
  patterns: string[];
}

export interface LeadModifierDictionaries {
  /** 照合用の作品名 (`normalizeWorkTitle`、別名を含む) → 作品の説明。`indexWorkDescriptions` で作る */
  workDescriptions: ReadonlyMap<string, string>;
  /** © の表記 → 持ち主 (`character-owners.yaml`、上から順に当てる) */
  characterOwners: CharacterOwner[];
  /** 原作タイプ → 媒体の表記 (`media-type-mapping.yaml` の `original_type_labels`。null は媒体なし) */
  originalTypeLabels: Record<string, string | null>;
  /**
   * 作品の形の表記 (`MediaFormResolverService.resolve`: メディアタイプ → 原作タイプ → 「作品」の順)。
   * 空や英語のキーのままにならない
   */
  mediaFormLabel: (sourceType: string | null | undefined, mediaType: string | null | undefined) => string;
}

export interface LeadModifierFacts {
  /** primary の作品名と、ほかの表記 (略称など)。作品の説明を引くのに使う */
  workTitles: string[];
  メディアタイプ?: string | null;
  原作タイプ?: string | null;
  原作者名?: string | string[] | null;
  スタジオ名?: string | null;
  /**
   * primary の作品の著作権表記 (抽出のコピーライト)。キャラクターの持ち主を引くのに使う。
   * ページ全体の © を渡さない (コラボ相手や広告の © で、別の会社のキャラクターと書いてしまうため)
   */
  コピーライト?: string | null;
  グループ区分?: GroupKind | null;
  性別?: Gender | null;
  ゲーム実況?: boolean | null;
}

const ANIME_MEDIA_TYPES = new Set(['anime', 'anime_movie']);

/** 作品名の照合用の形 (全角・半角と空白の違いを吸収する。辞書の重複の検査も同じ形で比べる) */
export function normalizeWorkTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, '');
}

/**
 * 作品の説明を、照合用の作品名 (別名を含む) から引ける形にする。
 * 作品名と別名は 1 つの作品だけを指す (重なると、どちらの文を使うかが辞書の並び順で決まってしまうため止める)
 *
 * @throws 1 つの名前が 2 つの作品に当たるとき
 */
export function indexWorkDescriptions(descriptions: Record<string, WorkDescription>): Map<string, string> {
  const owners = new Map<string, string>();
  const index = new Map<string, string>();
  for (const [name, entry] of Object.entries(descriptions)) {
    for (const label of [name, ...(entry.aliases ?? [])].map(normalizeWorkTitle)) {
      const other = owners.get(label);
      if (other !== undefined && other !== name) {
        throw new Error(`作品の説明: 「${label}」が「${other}」と「${name}」の両方にあります`);
      }
      owners.set(label, name);
      index.set(label, entry.modifier);
    }
  }
  return index;
}

function findWorkDescription(titles: string[], index: ReadonlyMap<string, string>): string | null {
  for (const title of titles) {
    const hit = index.get(normalizeWorkTitle(title));
    if (hit) return hit;
  }
  return null;
}

/** 著作権表記に当たる持ち主。2 つ以上の持ち主に当たったら、どちらか決められないので null (推測しない) */
function findCharacterOwner(notice: string | null | undefined, owners: CharacterOwner[]): string | null {
  const text = notice?.toLowerCase() ?? '';
  if (!text) return null;
  const hits = owners.filter((entry) => entry.patterns.some((pattern) => text.includes(pattern.toLowerCase())));
  return hits.length === 1 ? hits[0].owner : null;
}

/** 選んだ形のキーと、その形に埋めた文 (どの形に落ちたかをログとテストで見るため、キーも返す) */
export interface LeadModifierResult {
  form: (typeof LEAD_MODIFIER_KEYS)[number] | 'work_description';
  text: string;
}

export function buildLeadModifier(
  facts: LeadModifierFacts,
  format: LeadModifierFormat,
  dictionaries: LeadModifierDictionaries
): LeadModifierResult {
  const described = findWorkDescription(facts.workTitles, dictionaries.workDescriptions);
  if (described) return { form: 'work_description', text: described };

  const mediaType = facts.メディアタイプ ?? '';
  const sourceType = facts.原作タイプ ?? '';
  const authors = getAuthorNamesAsArray(facts.原作者名)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .join(format.authors_separator);
  const medium = (sourceType && dictionaries.originalTypeLabels[sourceType]) || null;
  const studio = facts.スタジオ名?.trim() || null;
  const group = facts.グループ区分 === 'group' ? format.group_word : '';
  const fill = (form: (typeof LEAD_MODIFIER_KEYS)[number], values: Record<string, string | null> = {}) => ({
    form,
    text: fillTemplate(format[form], values),
  });

  if (mediaType === 'movie') return fill('film');

  if (sourceType === 'character_brand') {
    const owner = findCharacterOwner(facts.コピーライト, dictionaries.characterOwners);
    return owner ? fill('character_owner', { owner }) : fill('character');
  }

  if (mediaType === 'idol') {
    const gender = facts.性別 === 'female' ? format.idol_female : facts.性別 === 'male' ? format.idol_male : '';
    return fill('idol', { gender, group });
  }

  if (mediaType === 'youtuber' || mediaType === 'vtuber') {
    const kind =
      mediaType === 'vtuber' ? format.vtuber_default : facts.ゲーム実況 === true ? format.youtuber_game : format.youtuber_default;
    return fill('youtuber', { kind, group });
  }

  if (mediaType === 'manga') {
    return fill('source_work', { authors, medium: medium ?? dictionaries.mediaFormLabel(null, mediaType) });
  }

  if (ANIME_MEDIA_TYPES.has(mediaType)) {
    const anime = mediaType === 'anime_movie' ? format.anime_movie_word : format.anime_word;
    if (sourceType === 'original_anime') return studio ? fill('original_studio', { studio, anime }) : fill('original', { anime });
    if (sourceType === 'studio_production') return studio ? fill('studio_work', { studio, anime }) : fill('anime_generic', { anime });
    if (sourceType === 'original_with_creator' && authors) return fill('original_creator', { authors, anime });
    if (authors && medium) return fill('anime_long', { authors, medium, anime });
    if (authors) return fill('anime_short', { authors, anime });
    if (medium) return fill('anime_no_author', { medium, anime });
    return fill('anime_generic', { anime });
  }

  return fill('media_generic', { media: dictionaries.mediaFormLabel(sourceType, mediaType) });
}
