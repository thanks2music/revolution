/**
 * リード文の連体修飾語 (作品名の前に置く語句) を、抽出の事実から機械的に組み立てる (Layer 1、純粋関数)。
 *
 * 形の文言と選び方の正本は Templates の `01-lead.yaml` の `modifier` (選び方はそのコメント)。
 * ここは選び方の実装で、文言は持たない。公式の情報から分かる事実だけで書き、分からない部分は
 * 推測で埋めずに短い形にする。作品ごとの言い回しは `work-descriptions.yaml` に書いた作品だけ使う。
 */

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
  /** 作品名 → 作品の説明 (`work-descriptions.yaml`) */
  workDescriptions: Record<string, WorkDescription>;
  /** © の表記 → 持ち主 (`character-owners.yaml`、上から順に当てる) */
  characterOwners: CharacterOwner[];
  /** 原作タイプ → 媒体の表記 (`media-type-mapping.yaml` の `original_type_labels`。null は媒体なし) */
  originalTypeLabels: Record<string, string | null>;
  /** メディアタイプ → 表記 (`media-type-mapping.yaml` の `media_type_mappings.*.label`) */
  mediaTypeLabel: (mediaType: string) => string;
}

export interface LeadModifierFacts {
  /** primary の作品名と、ほかの表記 (略称など)。作品の説明を引くのに使う */
  workTitles: string[];
  メディアタイプ?: string | null;
  原作タイプ?: string | null;
  原作者名?: string | string[] | null;
  スタジオ名?: string | null;
  /** 公式サイトの著作権表記 (© …)。キャラクターの持ち主を引くのに使う */
  著作権表記?: string[];
  グループ区分?: 'group' | 'solo' | null;
  性別?: 'female' | 'male' | 'mixed' | null;
  ゲーム実況?: boolean | null;
}

const ANIME_MEDIA_TYPES = new Set(['anime', 'anime_movie']);

function authorList(names: LeadModifierFacts['原作者名']): string[] {
  if (!names) return [];
  const list = Array.isArray(names) ? names : [names];
  return list.map((name) => name.trim()).filter((name) => name.length > 0);
}

function findWorkDescription(titles: string[], descriptions: LeadModifierDictionaries['workDescriptions']): string | null {
  const wanted = new Set(titles.map((title) => title.trim()).filter((title) => title.length > 0));
  for (const [name, entry] of Object.entries(descriptions)) {
    if ([name, ...(entry.aliases ?? [])].some((candidate) => wanted.has(candidate.trim()))) {
      return entry.modifier;
    }
  }
  return null;
}

function findCharacterOwner(notices: string[], owners: CharacterOwner[]): string | null {
  const text = notices.join('\n').toLowerCase();
  if (!text) return null;
  const hit = owners.find((entry) => entry.patterns.some((pattern) => text.includes(pattern.toLowerCase())));
  return hit?.owner ?? null;
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
  const authors = authorList(facts.原作者名).join(format.authors_separator);
  const medium = (sourceType && dictionaries.originalTypeLabels[sourceType]) || null;
  const studio = facts.スタジオ名?.trim() || null;
  const group = facts.グループ区分 === 'group' ? format.group_word : '';
  const fill = (form: (typeof LEAD_MODIFIER_KEYS)[number], values: Record<string, string | null> = {}) => ({
    form,
    text: fillTemplate(format[form], values),
  });

  if (mediaType === 'movie') return fill('film');

  if (sourceType === 'character_brand') {
    const owner = findCharacterOwner(facts.著作権表記 ?? [], dictionaries.characterOwners);
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
    return fill('source_work', { authors, medium: medium ?? dictionaries.mediaTypeLabel(mediaType) });
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

  return fill('media_generic', { media: dictionaries.mediaTypeLabel(mediaType) });
}
