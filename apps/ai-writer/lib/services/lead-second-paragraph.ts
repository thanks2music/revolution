/**
 * メニューの品名が取れないときの、リード文の 2 段落目 (2026-11-24)
 *
 * リード文のひな型の 2 段落目は、ノベルティ名があれば「ノベルティー「…」も用意されている」と書き、キャラクター名が
 * あれば「{キャラクター名}ら人気キャラクターをイメージしたコラボメニュー」と書く。品目が画像の中にしか無いサイトでは、
 * キャラクター名がグッズの絵柄から抽出され、メニューに結びつけると推測になる。そこで、メニューの品名が取れないときは、
 * 2 段落目をキャラクター名を挙げない文にする。ノベルティ名があればひな型と同じくノベルティ名を書き、無ければ本文に節が
 * あるグッズ・ノベルティーだけを書く (plain のひな型は menu_plain だけ)。
 *
 * 置き換えるひな型・文面・メディア形態の扱いは `sections/01-lead.yaml` の `rendered.no_novelty_name_second_paragraph`
 * (YAML が SoT)。ここは組み立てだけを行う。
 */
import { escapeMdxText } from '@/lib/utils/mdx-safety';
import { fillTemplate, loadChecked } from './section-renderers';

export interface NoNoveltySecondParagraphConfig {
  /** 置き換えるひな型の id と、メニューの文の種類 (plain はグッズ・ノベルティーの文を足さない) */
  templates: Record<string, 'work' | 'game' | 'plain'>;
  /** 3 段落目でグッズを書くひな型 (2 段落目ではグッズに触れない) */
  goods_in_third_paragraph: string[];
  /** この値のメディア形態は書かない (「作品」) */
  media_form_omit: string[];
  menu_work: string;
  menu_game: string;
  menu_plain: string;
  /** plain で、本文にグッズの節が無いとき */
  menu_plain_no_goods: string;
  goods_and_novelty: string;
  goods_only: string;
  novelty_only: string;
  /** ノベルティ名があるとき (ひな型と同じ文) */
  novelty_named: string;
  end: string;
}

const CONFIG_KEYS = [
  'templates',
  'goods_in_third_paragraph',
  'media_form_omit',
  'menu_work',
  'menu_game',
  'menu_plain',
  'menu_plain_no_goods',
  'goods_and_novelty',
  'goods_only',
  'novelty_only',
  'novelty_named',
  'end',
] as const satisfies readonly (keyof NoNoveltySecondParagraphConfig)[];

/**
 * `01-lead.yaml` の `rendered.no_novelty_name_second_paragraph` を読む
 *
 * @throws ファイル・キーが無いとき (`pnpm sync:templates` が要る)
 */
export function loadNoNoveltySecondParagraphConfig(dir?: string): NoNoveltySecondParagraphConfig {
  const rendered = loadChecked<{ no_novelty_name_second_paragraph: NoNoveltySecondParagraphConfig }>(
    '01-lead.yaml',
    'rendered',
    ['no_novelty_name_second_paragraph'],
    dir,
  );
  const config = rendered.no_novelty_name_second_paragraph;
  const missing = CONFIG_KEYS.filter((key) => config?.[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `01-lead.yaml の rendered.no_novelty_name_second_paragraph に ${missing.join(' / ')} がありません。pnpm sync:templates で Templates を同期してください`,
    );
  }
  return config;
}

export interface NoNoveltySecondParagraphInput {
  /** リード文に使ったひな型の id */
  templateId: string;
  作品名: string;
  /** 1 段落目のメディア形態表記 (アニメ・ゲームなど) */
  mediaForm: string;
  /** 本文にグッズの節があるか */
  hasGoods: boolean;
  /** 本文にノベルティの節があるか */
  hasNovelty: boolean;
  /** 抽出したノベルティ名 (あれば、ひな型と同じくノベルティ名を書く) */
  noveltyNames?: readonly string[] | null;
}

/** メニューの品名が取れないときの 2 段落目。置き換えないひな型なら null */
export function buildNoNoveltySecondParagraph(
  config: NoNoveltySecondParagraphConfig,
  input: NoNoveltySecondParagraphInput,
): string | null {
  const kind = config.templates[input.templateId];
  if (!kind || !input.作品名.trim()) return null;
  const hasGoods = input.hasGoods && !config.goods_in_third_paragraph.includes(input.templateId);
  const noveltyNames = (input.noveltyNames ?? []).filter((name) => name.trim());
  const values = {
    作品名: escapeMdxText(input.作品名),
    メディア形態: config.media_form_omit.includes(input.mediaForm) ? '' : escapeMdxText(input.mediaForm),
    ノベルティ名: noveltyNames.map(escapeMdxText),
  };
  if (kind === 'plain') {
    return fillTemplate(`${input.hasGoods ? config.menu_plain : config.menu_plain_no_goods}${config.end}`, values);
  }
  const extra = noveltyNames.length > 0
    ? config.novelty_named
    : hasGoods
    ? input.hasNovelty
      ? config.goods_and_novelty
      : config.goods_only
    : input.hasNovelty
      ? config.novelty_only
      : '';
  return fillTemplate(`${kind === 'game' ? config.menu_game : config.menu_work}${extra}${config.end}`, values);
}

/**
 * 段落を空行で区切った MDX の 2 段落目を置き換える。2 段落目が無ければそのまま。
 * 2 段落目の範囲だけを差し替え、ほかの空白・改行はそのまま残す (記事全体に当てるときに、本文の空行を変えないため)
 */
export function replaceSecondParagraph(text: string, paragraph: string): string {
  const first = /\n{2,}/g.exec(text);
  if (!first) return text;
  const start = first.index + first[0].length;
  const rest = text.slice(start);
  const next = /\n{2,}/.exec(rest);
  const end = next ? start + next.index : start + rest.replace(/\s+$/, '').length;
  if (end <= start) return text;
  return text.slice(0, start) + paragraph + text.slice(end);
}
