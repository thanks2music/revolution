import { z } from 'zod';

/**
 * `pipeline/2.5-subpage-extraction.yaml` の応答 (下層ページの抽出)。
 *
 * 2-extraction はトップページしか読まないため、下層ページ (メニュー・グッズ・ノベルティの各ページと、
 * 会場ごとの案内ページ) の文字を別に読む (2026-10-12)。ページごとに結果を返させるのは、
 * 会場によって違うノベルティ (「大阪会場のみ」) を書き分けるため。
 *
 * OpenAI の Structured Outputs (strict) に通すため、項目はすべて必須にし、値の無いものは null にする。
 */
export const SubpageMenuItemSchema = z.object({
  /** 品目に結び付いたキャラクター名 (【】を除く) */
  character: z.string().nullable(),
  name: z.string(),
  /** 「2,090円(税込)」の形。税込・税抜は書かれているときだけ */
  price: z.string().nullable(),
});

export const SubpagePageSchema = z.object({
  /** 入力の URL をそのまま返させる (ページの取り違えを防ぐ) */
  url: z.string(),
  /** 会場の地域名 (例: 東京)。会場の案内ページで読み取れたときだけ */
  area: z.string().nullable(),
  メニュー詳細リスト: z.array(SubpageMenuItemSchema).nullable(),
  グッズ名: z.array(z.string()).nullable(),
  ノベルティ名: z.array(z.string()).nullable(),
  キャラクター名: z.array(z.string()).nullable(),
  _reasoning: z.string().nullable(),
});

export const SubpageExtractionResponseSchema = z.object({
  pages: z.array(SubpagePageSchema),
});

export type SubpageMenuItem = z.infer<typeof SubpageMenuItemSchema>;
export type SubpagePage = z.infer<typeof SubpagePageSchema>;
export type SubpageExtractionResponse = z.infer<typeof SubpageExtractionResponseSchema>;
