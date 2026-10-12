/**
 * Vision で何を読むかを決める (Layer 1)。
 *
 * HTML の抽出から「キャラクター名・メニュー名・グッズ名・ノベルティ名」のどれかが書けない
 * ときだけ、欠けた分のカテゴリの画像を読む (2026-10-11 の方針)。キャラクター名が無いときは、
 * キャラクターの載りやすいメニューとグッズの両方を読む。
 *
 * 以前の判定 (`checkExtractionSufficiency`) はキャラクター名の数を品目数の代わりにしており、
 * ほとんどの記事で 3 カテゴリとも読んでいた。
 */
import type { ExtractionResult } from '@/lib/services/extraction.service';
import type { VisionExtractionCategory } from '@/lib/types/vision-api';
import { isEmptyList } from '@/lib/utils/llm-values';
import { VISION_CATEGORIES } from './category-prompt-resolver';

export type VisionTargetField = 'キャラクター名' | 'メニュー名' | 'グッズ名' | 'ノベルティ名';

export interface VisionTargets {
  /** HTML から書けなかった項目 */
  missingFields: VisionTargetField[];
  /** 画像を読むカテゴリ (`VISION_CATEGORIES` の順) */
  categories: VisionExtractionCategory[];
}

type ExtractionFields = Pick<
  ExtractionResult,
  'キャラクター名' | 'メニュー詳細リスト' | '具体的なメニュー名リスト' | 'グッズ名' | 'ノベルティ名'
>;


export function determineVisionTargets(extraction: ExtractionFields): VisionTargets {
  const missingFields: VisionTargetField[] = [];
  if (isEmptyList(extraction.キャラクター名)) missingFields.push('キャラクター名');
  if (isEmptyList(extraction.メニュー詳細リスト) && isEmptyList(extraction.具体的なメニュー名リスト)) {
    missingFields.push('メニュー名');
  }
  if (isEmptyList(extraction.グッズ名)) missingFields.push('グッズ名');
  if (isEmptyList(extraction.ノベルティ名)) missingFields.push('ノベルティ名');

  const needs = new Set<VisionExtractionCategory>();
  if (missingFields.includes('メニュー名')) needs.add('menu');
  if (missingFields.includes('グッズ名')) needs.add('goods');
  if (missingFields.includes('ノベルティ名')) needs.add('novelty');
  if (missingFields.includes('キャラクター名')) {
    needs.add('menu');
    needs.add('goods');
  }

  return {
    missingFields,
    categories: VISION_CATEGORIES.filter((category) => needs.has(category)),
  };
}
