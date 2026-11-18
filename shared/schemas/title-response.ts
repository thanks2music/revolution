import { z } from 'zod';

/**
 * `pipeline/3-title.yaml` の応答 (記事タイトル)。
 *
 * provider に JSON Schema として渡し、応答の形を強制する (OpenAI は Structured Outputs、Gemini は responseJsonSchema)。
 * 形を指定しないと、Gemini が `[ { "title": ... } ]` のように配列で包んで返し、タイトルが取れないことがあった。
 * OpenAI の Structured Outputs (strict) に通すため、項目は必須にする。
 */
export const TitleResponseSchema = z.object({
  /** 記事タイトル。文字数の検証は Revolution 側で行う */
  title: z.string(),
  /** タイトルの判断理由 (デバッグ用) */
  _reasoning: z.string(),
});

export type TitleResponse = z.infer<typeof TitleResponseSchema>;
