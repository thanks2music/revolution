import { z } from 'zod';

/**
 * `pipeline/4.5-article-points.yaml` の応答 (この記事のポイントの「本イベントの特徴」、2026-10-15)。
 *
 * 事実の行 (期間と会場・描き下ろし・グッズ・メニュー・ノベルティ) はコードが書くので、LLM が返すのは特徴の文だけ。
 * 数に上限は無い (特徴が無ければ空の配列)。OpenAI の Structured Outputs (strict) に通すため、項目は必須にする。
 */
export const ArticlePointsResponseSchema = z.object({
  /** 1 項目 = 1 文。箇条書きの記号は付けない (Revolution が付ける) */
  features: z.array(z.string()),
});

export type ArticlePointsResponse = z.infer<typeof ArticlePointsResponseSchema>;
