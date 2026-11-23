import { describe, expect, it } from '@jest/globals';

import type { PointsFormat } from '@/lib/services/article-points';
import { renderImageOnlySentence, type ImageOnlySentenceConfig } from '@/lib/services/image-only-sections';
import { NOVELTY_SECTION, replaceSectionSentence } from '@/lib/services/section-renderers';

const CONFIG: ImageOnlySentenceConfig = {
  image_only_sentence: '「{{subject}}」では、{{period}}まで期間限定のコラボイベントが開催される。',
  image_only_sentence_open: '「{{subject}}」では、{{period}}より期間限定のコラボイベントが開催される。',
};

/** 01b-points.yaml の rendered のうち、期間の書式 */
const POINTS = {
  date: '{{year}}年{{month}}月{{day}}日',
  date_same_year: '{{month}}月{{day}}日',
  period: '{{start}}〜{{end}}',
  period_open: '{{start}}〜',
} as unknown as PointsFormat;

describe('renderImageOnlySentence', () => {
  it('見出し主語と期間 (この記事のポイントと同じ書式) で文を組み立てる', () => {
    expect(renderImageOnlySentence(CONFIG, '作品A × カフェB', { start: '2026-12-02', end: '2026-12-17' }, POINTS)).toBe(
      '「作品A × カフェB」では、2026年12月2日〜12月17日まで期間限定のコラボイベントが開催される。',
    );
  });

  it('終了日が分からなければ、開始日だけの文にする', () => {
    expect(renderImageOnlySentence(CONFIG, '作品A × カフェB', { start: '2026-12-02' }, POINTS)).toBe(
      '「作品A × カフェB」では、2026年12月2日より期間限定のコラボイベントが開催される。',
    );
  });

  it('開始日か見出し主語が無ければ null (LLM の文を残す)', () => {
    expect(renderImageOnlySentence(CONFIG, '作品A', {}, POINTS)).toBeNull();
    expect(renderImageOnlySentence(CONFIG, ' ', { start: '2026-12-02' }, POINTS)).toBeNull();
  });

  it('見出し主語の MDX の記号はエスケープする', () => {
    expect(renderImageOnlySentence(CONFIG, 'A{x}', { start: '2026-12-02', end: '2026-12-03' }, POINTS)).not.toContain('{x}');
  });
});

describe('replaceSectionSentence', () => {
  it('節の見出しの直後の段落だけを置き換え、h3 と画像は残す', () => {
    const content = '## Aのノベルティー\n\nLLM の文。\n\n### ノベルティー\n\n<ArticleImage src="a.webp" />\n\n## Aのグッズ\n\nグッズの文。\n';
    const result = replaceSectionSentence(content, NOVELTY_SECTION, '期間の文。');

    expect(result).toContain('## Aのノベルティー\n\n期間の文。\n\n### ノベルティー\n\n<ArticleImage src="a.webp" />');
    expect(result).toContain('グッズの文。');
    expect(result).not.toContain('LLM の文。');
  });
});
