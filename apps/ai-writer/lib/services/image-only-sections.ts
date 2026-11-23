/**
 * 品名が無く、画像だけがあるノベルティ・グッズの節の導入の文 (2026-11-24)
 *
 * 品目が画像の中にしか無いサイト (Vision を呼ばないサイトなど) では、品名を書けない。本文の LLM は
 * Templates の `novelty_image_only` / `goods_image_only` の書き方で節を書き、見出しの直後の段落 (導入の文) は
 * ここで組み立てた文に置き換える (LLM に品名や特典の内容を推測で書かせないため)。
 * 文面は `sections/03-novelty.yaml` と `04-goods.yaml` の `rendered` (YAML が SoT)。
 */
import { escapeMdxText } from '@/lib/utils/mdx-safety';
import { formatPeriod, type PointsFormat } from './article-points';
import { fillTemplate } from './section-renderers';

/** 品名の無い節の導入の文のキー (`03-novelty.yaml` と `04-goods.yaml` の `rendered`) */
export const IMAGE_ONLY_RENDERED_KEYS = ['image_only_sentence', 'image_only_sentence_open'] as const;

export type ImageOnlySentenceConfig = Record<(typeof IMAGE_ONLY_RENDERED_KEYS)[number], string>;

/**
 * 導入の文。subject は節の見出しと同じ主語 (見出し主語)、期間の書式は「この記事のポイント」と同じ。
 * 終了日が分からなければ `image_only_sentence_open` (開始日だけ)。開始日が無ければ null (LLM の文をそのまま残す)
 */
export function renderImageOnlySentence(
  config: ImageOnlySentenceConfig,
  subject: string,
  period: { start?: string; end?: string },
  pointsFormat: PointsFormat,
): string | null {
  const open = !period.end;
  const text = formatPeriod(period, open ? { ...pointsFormat, period_open: '{{start}}' } : pointsFormat);
  if (!text || !subject.trim()) return null;
  return fillTemplate(open ? config.image_only_sentence_open : config.image_only_sentence, {
    subject: escapeMdxText(subject),
    period: text,
  });
}
