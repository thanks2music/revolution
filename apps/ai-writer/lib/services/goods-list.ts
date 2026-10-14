/**
 * グッズの一覧と、本文の文に並べるグッズ名 (2026-10-12)
 *
 * - 本文の文 (リード文・グッズの節の導入文) に並べるグッズ名は、先頭の `prose_limit` 件まで。
 *   コナンでグッズ名が 46 件になり、導入文が約 1,000 字の 1 文になったため
 * - 全件は、グッズの節の末尾の一覧に書く。`list_max_items` 件までは箇条書き、それより多ければ表
 * - 一覧に載せるのは会場で買えるグッズだけ。オンライン限定のグッズがあれば、品名は並べずに 1 文だけ書く
 *   (anime-events は「体験した想いを記録する」サイトのため、会場で見て・迷って・買えるグッズを中心に書く)
 *
 * 文言と書式は Templates の `sections/04-goods.yaml` の `goods_list` (YAML が SoT)。ここは組み立てだけを行う。
 * 一覧はコードで差し込む (本文の LLM に任せると、数十件を漏れなく書き写す保証が無いため)。
 *
 * 品目ごとの画像があるとき (2026-10-13 BOSS 決定) は、箇条書き・表の代わりに品目ごとに見出し (品名・価格)・
 * 販売方法・画像を並べる (`item_heading` / `item_sales_line`)。画像の無い品目も同じ形で並べる。
 */
import type { GoodsSales, SubpageGoodsItem } from '@revolution/schemas/subpage-extraction-response';
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';
import { appendToSection, fillTemplate as fill, findSection, loadSectionYaml, otherImagesBlock, tableCell as cell } from '@/lib/services/section-renderers';
import { escapeMdxText } from '@/lib/utils/mdx-safety';

/** `sections/04-goods.yaml` の `goods_list` */
export interface GoodsListConfig {
  prose_limit: number;
  list_max_items: number;
  heading: string;
  bullet: string;
  table_header: string;
  table_divider: string;
  table_row: string;
  sales_labels: Partial<Record<GoodsSales, string>>;
  online_only_note: string;
  /** 品目ごとの画像があるときの見出しと販売方法の行 (04-goods.yaml 1.2.0) */
  item_heading: string;
  item_sales_line: string;
  /** 品目ごとの形のとき、どの品目にも照合できなかった画像の前に付ける見出し */
  other_images_heading: string;
}

/**
 * `sections/04-goods.yaml` の `goods_list` を読む (キャッシュあり)。
 *
 * @throws YAML が無い、または `goods_list` が無いとき (`pnpm sync:templates` が要る)
 */
export function loadGoodsListConfig(dir?: string): GoodsListConfig {
  return loadSectionYaml<GoodsListConfig>('04-goods.yaml', 'goods_list', dir);
}

/** 本文の文に並べるグッズ名 (先頭の数件)。残りは本文の「など」で受け、一覧に全件を書く */
export function goodsNamesForProse(names: string[] | null | undefined, config: GoodsListConfig): string[] | null {
  if (!names || names.length === 0) return names ?? null;
  return names.slice(0, config.prose_limit);
}

/**
 * グッズの一覧の Markdown を組み立てる。並びはグッズ名の順 (会場で買えるもの)。
 * 価格・販売方法は、品名が一致した詳細から取る (無ければ空)。グッズ名が無ければ空文字。
 */
export function renderGoodsList(
  names: string[] | null | undefined,
  details: SubpageGoodsItem[] | null | undefined,
  config: GoodsListConfig,
  /** names[i] の画像 (書き出し済みの画像の MDX)。1 件でもあれば品目ごとの形にする */
  itemImages: string[] = [],
  /** 品目ごとの形のとき、品目の後に見出し (other_images_heading) を付けて並べる画像 (どの品目にも照合できなかったもの。節の末尾) */
  trailingImages = ''
): string {
  const byKey = new Map((details ?? []).map((item) => [itemNameKey(item.name), item]));
  const rows = (names ?? []).map((name) => {
    const detail = byKey.get(itemNameKey(name));
    // 品名と価格は外部のページから読んだ値。MDX の式・JSX として評価されないようにする
    return {
      name: escapeMdxText(name),
      price: escapeMdxText(detail?.price ?? ''),
      sales: detail?.sales ? (config.sales_labels[detail.sales] ?? '') : '',
    };
  });

  const lines: string[] = [];
  if (rows.length > 0 && itemImages.some(Boolean)) {
    rows.forEach((row, index) => {
      if (lines.length > 0) lines.push('');
      lines.push(fill(config.item_heading, row));
      if (row.sales) lines.push('', fill(config.item_sales_line, row));
      if (itemImages[index]) lines.push('', itemImages[index]);
    });
    const other = otherImagesBlock(config.other_images_heading, trailingImages);
    if (other) lines.push('', other);
  } else if (rows.length > 0) {
    lines.push(config.heading, '');
    if (rows.length <= config.list_max_items) {
      lines.push(...rows.map((row) => fill(config.bullet, row)));
    } else {
      lines.push(
        config.table_header,
        config.table_divider,
        ...rows.map((row) =>
          fill(config.table_row, { name: cell(row.name), price: cell(row.price), sales: cell(row.sales) })
        )
      );
    }
  }
  if ((details ?? []).some((item) => item.sales === 'online_only')) {
    if (lines.length > 0) lines.push('');
    lines.push(config.online_only_note);
  }
  return lines.join('\n');
}

const GOODS_SECTION = /^## .*グッズ[ \t]*$/m;

/** グッズの節があるか (品目ごとの画像は、節が無いと差し込めない) */
export function hasGoodsSection(content: string): boolean {
  return findSection(content, GOODS_SECTION) !== null;
}

/**
 * グッズの節 (`## …のグッズ`) の末尾に差し込む。グッズの節が無ければ (画像が無く書かれなかったなど) 何もしない。
 */
export function insertIntoGoodsSection(content: string, block: string): string {
  return appendToSection(content, GOODS_SECTION, block);
}
