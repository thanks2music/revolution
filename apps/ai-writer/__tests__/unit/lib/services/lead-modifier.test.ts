/**
 * Layer 1: 連体修飾語の組み立て (`buildLeadModifier`)。
 *
 * 期待値の表は、作品ごとに抽出の結果を入力にして、「どの形を選び、何を埋めたか」を固定する。
 * 文言と辞書は中立の fixture にする (Templates の文面と辞書は private のため、この public repo に写さない)。
 * 実際の文言で全キーが読めることは `validate:templates` が、記事の文は dry-run が見る。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildLeadModifier,
  LEAD_MODIFIER_KEYS,
  type LeadModifierDictionaries,
  type LeadModifierFacts,
  type LeadModifierFormat,
} from '@/lib/services/lead-modifier';
import { loadLeadFallbackPrompt, loadWorkDescriptions } from '@/lib/services/lead-modifier-config';

/** 各形を「形の名前[埋めた値]」で書く中立の文言 (どの形に何を埋めたかが文字列で分かる) */
const FORMAT = {
  ...(Object.fromEntries(LEAD_MODIFIER_KEYS.map((key) => [key, key])) as LeadModifierFormat),
  anime_long: 'anime_long[{{authors}}|{{medium}}|{{anime}}]',
  anime_short: 'anime_short[{{authors}}|{{anime}}]',
  anime_no_author: 'anime_no_author[{{medium}}|{{anime}}]',
  original_studio: 'original_studio[{{studio}}|{{anime}}]',
  original: 'original[{{anime}}]',
  original_creator: 'original_creator[{{authors}}|{{anime}}]',
  studio_work: 'studio_work[{{studio}}|{{anime}}]',
  anime_generic: 'anime_generic[{{anime}}]',
  anime_word: 'TV',
  anime_movie_word: 'MOVIE',
  source_work: 'source_work[{{#if authors}}{{authors}}|{{/if}}{{medium}}]',
  authors_separator: ' / ',
  character_owner: 'character_owner[{{owner}}]',
  character: 'character[]',
  idol: 'idol[{{gender}}|{{group}}]',
  idol_female: 'F',
  idol_male: 'M',
  youtuber: 'youtuber[{{kind}}|{{group}}]',
  youtuber_game: 'GAME',
  youtuber_default: 'YT',
  vtuber_default: 'VT',
  group_word: 'G',
  film: 'film[]',
  media_generic: 'media_generic[{{media}}]',
} satisfies LeadModifierFormat;

/** 媒体の表記 (public: shared/schemas/media-form-mapping.ts の EXPECTED_ORIGINAL_TYPE_LABELS と同じ値) */
const ORIGINAL_TYPE_LABELS: Record<string, string | null> = {
  manga_based: '漫画',
  novel_based: '小説',
  original_with_creator: null,
  original_anime: 'アニメ',
  studio_production: null,
  character_brand: 'キャラクター',
  youtuber: 'YouTuber',
  idol: 'アイドル',
  game_original: 'ゲーム',
  other: null,
};
const MEDIA_LABELS: Record<string, string> = { manga: '漫画', game: 'ゲーム' };

const EMPTY_DICTIONARIES: LeadModifierDictionaries = {
  workDescriptions: {},
  characterOwners: [
    { owner: '持ち主A', patterns: ['OWNER-A'] },
    { owner: '持ち主B', patterns: ['OWNER-B'] },
  ],
  originalTypeLabels: ORIGINAL_TYPE_LABELS,
  // MediaFormResolverService.resolve と同じ順 (メディアタイプ → 原作タイプ → 作品)
  mediaFormLabel: (sourceType, mediaType) =>
    (mediaType && MEDIA_LABELS[mediaType]) || (sourceType && ORIGINAL_TYPE_LABELS[sourceType]) || '作品',
};

const DICTIONARIES: LeadModifierDictionaries = {
  ...EMPTY_DICTIONARIES,
  workDescriptions: {
    'キャラA': { modifier: '説明A', aliases: ['別名A'] },
    '作品B!!': { modifier: '説明B' },
  },
};

interface Case {
  name: string;
  facts: LeadModifierFacts;
  /** 辞書に作品の説明が無い時 */
  plain: string;
  /** 辞書に作品の説明がある時 (無ければ plain と同じ) */
  described?: string;
}

const anime = (extra: Partial<LeadModifierFacts>): LeadModifierFacts => ({ workTitles: ['X'], メディアタイプ: 'anime', ...extra });

// BOSS 確認済みの期待値の表 (2026-11-24) の作品ごとの形。抽出の値は各作品の公式の表記に合わせた
const CASES: Case[] = [
  { name: '1 ハイキュー!!', facts: anime({ 原作タイプ: 'manga_based', 原作者名: ['古舘春一先生'] }), plain: 'anime_long[古舘春一先生|漫画|TV]' },
  { name: '2 僕のヒーローアカデミア', facts: anime({ 原作タイプ: 'manga_based', 原作者名: ['堀越耕平先生'] }), plain: 'anime_long[堀越耕平先生|漫画|TV]' },
  { name: '3 BANANA FISH', facts: anime({ 原作タイプ: 'manga_based', 原作者名: ['吉田秋生先生'] }), plain: 'anime_long[吉田秋生先生|漫画|TV]' },
  { name: '4 呪術廻戦', facts: anime({ 原作タイプ: 'manga_based', 原作者名: ['芥見下々先生'] }), plain: 'anime_long[芥見下々先生|漫画|TV]' },
  {
    name: '5 ブルーロック (原作者 2 名)',
    facts: anime({ 原作タイプ: 'manga_based', 原作者名: ['金城宗幸先生', 'ノ村優介先生'] }),
    plain: 'anime_long[金城宗幸先生 / ノ村優介先生|漫画|TV]',
  },
  { name: '6 薬屋のひとりごと', facts: anime({ 原作タイプ: 'novel_based', 原作者名: ['日向夏先生'] }), plain: 'anime_long[日向夏先生|小説|TV]' },
  { name: '7 リコリス・リコイル', facts: anime({ 原作タイプ: 'original_anime', スタジオ名: 'A-1 Pictures' }), plain: 'original_studio[A-1 Pictures|TV]' },
  {
    name: '8・9 キャラクター (© から持ち主)',
    facts: { workTitles: ['キャラA'], メディアタイプ: 'character', 原作タイプ: 'character_brand', 著作権表記: '© 2026 owner-a CO., LTD.' },
    plain: 'character_owner[持ち主A]',
    described: '説明A',
  },
  {
    name: '10 ゲーム実況者グループ',
    facts: { workTitles: ['X'], メディアタイプ: 'youtuber', 原作タイプ: 'youtuber', グループ区分: 'group', ゲーム実況: true },
    plain: 'youtuber[GAME|G]',
  },
  { name: '11 女性アイドルグループ', facts: { workTitles: ['X'], メディアタイプ: 'idol', 原作タイプ: 'idol', グループ区分: 'group', 性別: 'female' }, plain: 'idol[F|G]' },
  { name: '12 男性アイドルグループ', facts: { workTitles: ['X'], メディアタイプ: 'idol', 原作タイプ: 'idol', グループ区分: 'group', 性別: 'male' }, plain: 'idol[M|G]' },
  { name: '13 実写の映画', facts: { workTitles: ['X'], メディアタイプ: 'movie', 原作タイプ: 'studio_production' }, plain: 'film[]' },
  { name: '14 原作者あり・媒体なし', facts: anime({ 原作タイプ: 'other', 原作者名: ['PEACH-PIT先生'] }), plain: 'anime_short[PEACH-PIT先生|TV]' },
  { name: '15 原作者なし・媒体あり', facts: anime({ 原作タイプ: 'manga_based', 原作者名: null }), plain: 'anime_no_author[漫画|TV]' },
  { name: '16 何も分からない', facts: anime({ 原作タイプ: 'other' }), plain: 'anime_generic[TV]' },
  {
    name: '17 原作そのものとのコラボ',
    facts: { workTitles: ['X'], メディアタイプ: 'manga', 原作タイプ: 'manga_based', 原作者名: ['芥見下々先生'] },
    plain: 'source_work[芥見下々先生|漫画]',
  },
  {
    name: '18 劇場版',
    facts: { workTitles: ['X'], メディアタイプ: 'anime_movie', 原作タイプ: 'manga_based', 原作者名: ['芥見下々先生'] },
    plain: 'anime_long[芥見下々先生|漫画|MOVIE]',
  },
  { name: 'Q14 オリジナル・スタジオ不明', facts: anime({ 原作タイプ: 'original_anime' }), plain: 'original[TV]' },
  { name: 'Q15 YouTuber・種類不明・グループ', facts: { workTitles: ['X'], メディアタイプ: 'youtuber', 原作タイプ: 'youtuber', グループ区分: 'group' }, plain: 'youtuber[YT|G]' },
];

describe('buildLeadModifier: 期待値の表', () => {
  it.each(CASES)('$name (辞書なし)', ({ facts, plain }) => {
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe(plain);
  });

  it.each(CASES)('$name (辞書あり)', ({ facts, plain, described }) => {
    expect(buildLeadModifier(facts, FORMAT, DICTIONARIES).text).toBe(described ?? plain);
  });
});

describe('buildLeadModifier: 推測で埋めない', () => {
  it('原作者有無が true でも、原作者名が無ければ「原作者なし」の形にする', () => {
    expect(buildLeadModifier(anime({ 原作タイプ: 'manga_based', 原作者名: [] }), FORMAT, EMPTY_DICTIONARIES)).toEqual({
      form: 'anime_no_author',
      text: 'anime_no_author[漫画|TV]',
    });
  });

  it('監督のオリジナル作品に「原作」の形を使わない', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'anime_movie', 原作タイプ: 'original_with_creator', 原作者名: ['新海誠監督'] };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('original_creator[新海誠監督|MOVIE]');
  });

  it('スタジオの作品は「オリジナル」の形を使わない (童話などの原作があることもある)', () => {
    expect(buildLeadModifier(anime({ 原作タイプ: 'studio_production', スタジオ名: 'S' }), FORMAT, EMPTY_DICTIONARIES).text).toBe('studio_work[S|TV]');
    expect(buildLeadModifier(anime({ 原作タイプ: 'studio_production' }), FORMAT, EMPTY_DICTIONARIES).text).toBe('anime_generic[TV]');
  });

  it('© から持ち主が分からないキャラクターは、持ち主を書かない', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'character', 原作タイプ: 'character_brand', 著作権表記: '©X Inc.' };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('character[]');
  });

  it('© が 2 つの持ち主に当たったら、どちらとも決めずに持ち主を書かない', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'character', 原作タイプ: 'character_brand', 著作権表記: '©OWNER-A ©OWNER-B' };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('character[]');
  });

  it('アイドルの性別・グループが書いていなければ付けない (男女混成も性別を付けない)', () => {
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'idol' }, FORMAT, EMPTY_DICTIONARIES).text).toBe('idol[|]');
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'idol', 性別: 'mixed', グループ区分: 'group' }, FORMAT, EMPTY_DICTIONARIES).text).toBe(
      'idol[|G]'
    );
  });

  it('VTuber はゲーム実況でも VTuber の表記にする', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'vtuber', ゲーム実況: true, グループ区分: 'solo' as const };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('youtuber[VT|]');
  });

  it('原作そのものとのコラボで、原作者が無く原作タイプに媒体も無ければ、メディアタイプの表記だけ', () => {
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'manga', 原作タイプ: 'other' }, FORMAT, EMPTY_DICTIONARIES).text).toBe('source_work[漫画]');
  });

  it('それ以外のメディアタイプは作品の形の表記を使い、空や英語のキーにしない', () => {
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'game', 原作タイプ: 'game_original' }, FORMAT, EMPTY_DICTIONARIES).text).toBe(
      'media_generic[ゲーム]'
    );
    expect(buildLeadModifier({ workTitles: ['X'], 原作タイプ: 'novel_based' }, FORMAT, EMPTY_DICTIONARIES).text).toBe('media_generic[小説]');
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'webtoon' }, FORMAT, EMPTY_DICTIONARIES).text).toBe('media_generic[作品]');
  });

  it('作品の説明は、別名・全角と半角・空白の違いでも引ける', () => {
    expect(buildLeadModifier({ workTitles: ['別名A'], メディアタイプ: 'character' }, FORMAT, DICTIONARIES).form).toBe('work_description');
    expect(buildLeadModifier({ workTitles: ['作品Ｂ！！'], メディアタイプ: 'anime' }, FORMAT, DICTIONARIES).text).toBe('説明B');
    expect(buildLeadModifier({ workTitles: ['作品 B!!'], メディアタイプ: 'anime' }, FORMAT, DICTIONARIES).text).toBe('説明B');
  });
});

describe('lead-modifier-config', () => {
  function writeFile(name: string, body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-modifier-'));
    fs.writeFileSync(path.join(dir, name), body);
    return dir;
  }

  it('作品名と別名が 2 つの作品に重なったら止める (全角・半角の違いも重なりとみなす)', () => {
    const dir = writeFile('work-descriptions.yaml', 'work_descriptions:\n  A:\n    modifier: a\n    aliases: [Ｂ]\n  B:\n    modifier: b\n');
    expect(() => loadWorkDescriptions(dir)).toThrow('「B」が「A」と「B」の両方にあります');
  });

  it('modifier が無い作品は名前を挙げて止める', () => {
    const dir = writeFile('work-descriptions.yaml', 'work_descriptions:\n  A:\n    aliases: [B]\n');
    expect(() => loadWorkDescriptions(dir)).toThrow('work_descriptions.A.modifier');
  });

  it('中身が空の辞書は空として読む', () => {
    expect(loadWorkDescriptions(writeFile('work-descriptions.yaml', 'work_descriptions:\n'))).toEqual({});
  });

  it('ファイルが無ければ同期を促して止める', () => {
    expect(() => loadWorkDescriptions(fs.mkdtempSync(path.join(os.tmpdir(), 'none-')))).toThrow('pnpm sync:templates');
  });

  it('fallback_prompt に Revolution が埋めない {{…}} があれば止める (空で LLM に届くため)', () => {
    const dir = writeFile('01-lead.yaml', 'fallback_prompt: "作品: {{作品名}} 監督: {{監督名}}"\n');
    expect(() => loadLeadFallbackPrompt(dir)).toThrow('{{監督名}}');
  });
});
