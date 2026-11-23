/**
 * Layer 1: 連体修飾語の組み立て (`buildLeadModifier`)。
 *
 * 期待値の表は、作品ごとに抽出の結果を入力にして、作品名の前に置く語句を固定する。
 * 文言と辞書は Templates の値を写した fixture (CI に Templates が無いため。同期した Templates との一致は
 * `validate:templates` の consumer contract が見る)。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildLeadModifier, type LeadModifierDictionaries, type LeadModifierFacts, type LeadModifierFormat } from '@/lib/services/lead-modifier';
import { loadWorkDescriptions } from '@/lib/services/lead-modifier-config';

/** Templates の sections/01-lead.yaml の modifier と同じ */
const FORMAT: LeadModifierFormat = {
  anime_long: '{{authors}}による人気{{medium}}を原作とした{{anime}}',
  anime_short: '{{authors}}原作の{{anime}}',
  anime_no_author: '人気{{medium}}を原作とした{{anime}}',
  original_studio: '{{studio}}制作によるオリジナル{{anime}}',
  original: 'オリジナル{{anime}}',
  original_creator: '{{authors}}によるオリジナル{{anime}}',
  studio_work: '{{studio}}制作の人気{{anime}}',
  anime_generic: '人気{{anime}}',
  anime_word: 'アニメ',
  anime_movie_word: 'アニメ映画',
  source_work: '{{#if authors}}{{authors}}による{{/if}}人気{{medium}}',
  authors_separator: ' / ',
  character_owner: '{{owner}}の人気キャラクター',
  character: '人気キャラクター',
  idol: '人気{{gender}}アイドル{{group}}',
  idol_female: '女性',
  idol_male: '男性',
  youtuber: '人気{{kind}}{{group}}',
  youtuber_game: 'ゲーム実況者',
  youtuber_default: 'YouTuber',
  vtuber_default: 'VTuber',
  group_word: 'グループ',
  film: '映画',
  media_generic: '人気{{media}}',
};

/** Templates の config/media-type-mapping.yaml と同じ (使う分だけ) */
const ORIGINAL_TYPE_LABELS: Record<string, string | null> = {
  manga_based: '漫画',
  novel_based: '小説',
  original_with_creator: null,
  original_anime: 'アニメ',
  studio_production: null,
  character_brand: 'キャラクター',
  youtuber: 'YouTuber',
  idol: 'アイドル',
  other: null,
};
const MEDIA_TYPE_LABELS: Record<string, string> = { manga: '漫画', game: 'ゲーム', vtuber: 'VTuber', other: '作品' };

const EMPTY_DICTIONARIES: LeadModifierDictionaries = {
  workDescriptions: {},
  characterOwners: [
    { owner: 'ディズニー', patterns: ['Disney'] },
    { owner: 'サンリオ', patterns: ['SANRIO'] },
  ],
  originalTypeLabels: ORIGINAL_TYPE_LABELS,
  mediaTypeLabel: (mediaType) => MEDIA_TYPE_LABELS[mediaType] ?? mediaType,
};

const DICTIONARIES: LeadModifierDictionaries = {
  ...EMPTY_DICTIONARIES,
  workDescriptions: {
    くまのプーさん: { modifier: '世界中で愛されるディズニーの人気キャラクター', aliases: ['プーさん'] },
    ポチャッコ: { modifier: '世代を超えて愛されるサンリオの人気キャラクター' },
    ドズル社: { modifier: 'マインクラフトの動画で人気を博すゲーム実況者グループ' },
    'スター・ウォーズ／マンダロリアン・アンド・グローグー': { modifier: '人気映画シリーズの最新作' },
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

const anime = (title: string, extra: Partial<LeadModifierFacts>): LeadModifierFacts => ({
  workTitles: [title],
  メディアタイプ: 'anime',
  ...extra,
});

// BOSS 確認済みの期待値 (2026-11-24、grill-with-docs の Q13〜Q15)
const CASES: Case[] = [
  { name: '1 ハイキュー!!', facts: anime('ハイキュー!!', { 原作タイプ: 'manga_based', 原作者名: ['古舘春一先生'] }), plain: '古舘春一先生による人気漫画を原作としたアニメ' },
  { name: '2 僕のヒーローアカデミア', facts: anime('僕のヒーローアカデミア', { 原作タイプ: 'manga_based', 原作者名: ['堀越耕平先生'] }), plain: '堀越耕平先生による人気漫画を原作としたアニメ' },
  { name: '3 BANANA FISH', facts: anime('BANANA FISH', { 原作タイプ: 'manga_based', 原作者名: ['吉田秋生先生'] }), plain: '吉田秋生先生による人気漫画を原作としたアニメ' },
  { name: '4 呪術廻戦', facts: anime('呪術廻戦', { 原作タイプ: 'manga_based', 原作者名: ['芥見下々先生'] }), plain: '芥見下々先生による人気漫画を原作としたアニメ' },
  {
    name: '5 ブルーロック (原作者 2 名)',
    facts: anime('ブルーロック', { 原作タイプ: 'manga_based', 原作者名: ['金城宗幸先生', 'ノ村優介先生'] }),
    plain: '金城宗幸先生 / ノ村優介先生による人気漫画を原作としたアニメ',
  },
  { name: '6 薬屋のひとりごと', facts: anime('薬屋のひとりごと', { 原作タイプ: 'novel_based', 原作者名: ['日向夏先生'] }), plain: '日向夏先生による人気小説を原作としたアニメ' },
  { name: '7 リコリス・リコイル', facts: anime('リコリス・リコイル', { 原作タイプ: 'original_anime', スタジオ名: 'A-1 Pictures' }), plain: 'A-1 Pictures制作によるオリジナルアニメ' },
  {
    name: '8 くまのプーさん',
    facts: { workTitles: ['くまのプーさん'], メディアタイプ: 'character', 原作タイプ: 'character_brand', 著作権表記: ['©Disney. Based on the "Winnie the Pooh" works'] },
    plain: 'ディズニーの人気キャラクター',
    described: '世界中で愛されるディズニーの人気キャラクター',
  },
  {
    name: '9 ポチャッコ',
    facts: { workTitles: ['ポチャッコ'], メディアタイプ: 'character', 原作タイプ: 'character_brand', 著作権表記: ['© 2026 SANRIO CO., LTD.'] },
    plain: 'サンリオの人気キャラクター',
    described: '世代を超えて愛されるサンリオの人気キャラクター',
  },
  {
    name: '10 ドズル社',
    facts: { workTitles: ['ドズル社'], メディアタイプ: 'youtuber', 原作タイプ: 'youtuber', グループ区分: 'group', ゲーム実況: true },
    plain: '人気ゲーム実況者グループ',
    described: 'マインクラフトの動画で人気を博すゲーム実況者グループ',
  },
  { name: '11 NiziU', facts: { workTitles: ['NiziU'], メディアタイプ: 'idol', 原作タイプ: 'idol', グループ区分: 'group', 性別: 'female' }, plain: '人気女性アイドルグループ' },
  {
    name: '12 TOMORROW X TOGETHER',
    facts: { workTitles: ['TOMORROW X TOGETHER'], メディアタイプ: 'idol', 原作タイプ: 'idol', グループ区分: 'group', 性別: 'male' },
    plain: '人気男性アイドルグループ',
  },
  {
    name: '13 スター・ウォーズ (実写の映画)',
    facts: { workTitles: ['スター・ウォーズ／マンダロリアン・アンド・グローグー'], メディアタイプ: 'movie', 原作タイプ: 'studio_production' },
    plain: '映画',
    described: '人気映画シリーズの最新作',
  },
  { name: '14 原作者あり・媒体なし', facts: anime('ローゼンメイデン', { 原作タイプ: 'other', 原作者名: ['PEACH-PIT先生'] }), plain: 'PEACH-PIT先生原作のアニメ' },
  { name: '15 原作者なし・媒体あり', facts: anime('X', { 原作タイプ: 'manga_based', 原作者名: null }), plain: '人気漫画を原作としたアニメ' },
  { name: '16 何も分からない', facts: anime('X', { 原作タイプ: 'other' }), plain: '人気アニメ' },
  {
    name: '17 原作そのものとのコラボ',
    facts: { workTitles: ['呪術廻戦'], メディアタイプ: 'manga', 原作タイプ: 'manga_based', 原作者名: ['芥見下々先生'] },
    plain: '芥見下々先生による人気漫画',
  },
  {
    name: '18 劇場版',
    facts: { workTitles: ['劇場版 呪術廻戦 0'], メディアタイプ: 'anime_movie', 原作タイプ: 'manga_based', 原作者名: ['芥見下々先生'] },
    plain: '芥見下々先生による人気漫画を原作としたアニメ映画',
  },
  { name: 'Q14 オリジナル・スタジオ不明', facts: anime('X', { 原作タイプ: 'original_anime' }), plain: 'オリジナルアニメ' },
  { name: 'Q15 YouTuber・種類不明・グループ', facts: { workTitles: ['X'], メディアタイプ: 'youtuber', 原作タイプ: 'youtuber', グループ区分: 'group' }, plain: '人気YouTuberグループ' },
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
    const result = buildLeadModifier(anime('X', { 原作タイプ: 'manga_based', 原作者名: [] }), FORMAT, EMPTY_DICTIONARIES);
    expect(result).toEqual({ form: 'anime_no_author', text: '人気漫画を原作としたアニメ' });
  });

  it('監督のオリジナル作品に「原作」と書かない', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'anime_movie', 原作タイプ: 'original_with_creator', 原作者名: ['新海誠監督'] };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('新海誠監督によるオリジナルアニメ映画');
  });

  it('スタジオの作品は「オリジナル」と断定しない (童話などの原作があることもある)', () => {
    expect(buildLeadModifier(anime('X', { 原作タイプ: 'studio_production', スタジオ名: 'ピクサー' }), FORMAT, EMPTY_DICTIONARIES).text).toBe(
      'ピクサー制作の人気アニメ'
    );
    expect(buildLeadModifier(anime('X', { 原作タイプ: 'studio_production' }), FORMAT, EMPTY_DICTIONARIES).text).toBe('人気アニメ');
  });

  it('持ち主が © から分からないキャラクターは「人気キャラクター」だけにする', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'character', 原作タイプ: 'character_brand', 著作権表記: ['©X Inc.'] };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('人気キャラクター');
  });

  it('© の照合は大文字・小文字を区別しない', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'character', 原作タイプ: 'character_brand', 著作権表記: ['©Sanrio'] };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('サンリオの人気キャラクター');
  });

  it('アイドルの性別・グループが書いていなければ付けない', () => {
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'idol' }, FORMAT, EMPTY_DICTIONARIES).text).toBe('人気アイドル');
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'idol', 性別: 'mixed', グループ区分: 'group' }, FORMAT, EMPTY_DICTIONARIES).text).toBe(
      '人気アイドルグループ'
    );
  });

  it('VTuber はゲーム実況でも VTuber と書く', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'vtuber', ゲーム実況: true, グループ区分: 'solo' as const };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('人気VTuber');
  });

  it('原作そのものとのコラボで原作タイプに媒体が無ければ、メディアタイプの表記を使う', () => {
    const facts = { workTitles: ['X'], メディアタイプ: 'manga', 原作タイプ: 'other' };
    expect(buildLeadModifier(facts, FORMAT, EMPTY_DICTIONARIES).text).toBe('人気漫画');
  });

  it('それ以外のメディアタイプはメディアタイプの表記を使う', () => {
    expect(buildLeadModifier({ workTitles: ['X'], メディアタイプ: 'game', 原作タイプ: 'game_original' }, FORMAT, EMPTY_DICTIONARIES).text).toBe('人気ゲーム');
  });

  it('作品の説明は別名でも引ける', () => {
    expect(buildLeadModifier({ workTitles: ['プーさん'], メディアタイプ: 'character' }, FORMAT, DICTIONARIES).form).toBe('work_description');
  });
});

describe('loadWorkDescriptions', () => {
  function writeConfig(body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-descriptions-'));
    fs.writeFileSync(path.join(dir, 'work-descriptions.yaml'), body);
    return dir;
  }

  it('作品名と別名が 2 つの作品に重なったら止める', () => {
    const dir = writeConfig('work_descriptions:\n  A:\n    modifier: a\n    aliases: [B]\n  B:\n    modifier: b\n');
    expect(() => loadWorkDescriptions(dir)).toThrow('「B」が「A」と「B」の両方にあります');
  });

  it('modifier が無い作品は名前を挙げて止める', () => {
    const dir = writeConfig('work_descriptions:\n  A:\n    aliases: [B]\n');
    expect(() => loadWorkDescriptions(dir)).toThrow('work_descriptions.A.modifier');
  });

  it('ファイルが無ければ同期を促して止める', () => {
    expect(() => loadWorkDescriptions(fs.mkdtempSync(path.join(os.tmpdir(), 'none-')))).toThrow('pnpm sync:templates');
  });
});
