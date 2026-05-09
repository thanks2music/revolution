/**
 * Layer 1 unit tests for `pipeline-steps.ts`.
 *
 * Verifies pure-function contracts on the pipeline-step SoT:
 * - id↔index mapping is stable
 * - display format is dynamic (no hardcoded total length)
 * - all ids are unique, non-empty kebab-case
 */

import { describe, it, expect } from '@jest/globals';
import {
  PIPELINE_STEPS,
  getStepIndex,
  getStepDisplay,
  getStepLabel,
} from '@/lib/services/pipeline-steps';

describe('pipeline-steps — Layer 1 contracts', () => {
  it('case A: getStepIndex returns the array position of a known id', () => {
    expect(getStepIndex('article-selection')).toBe(0);
    expect(getStepIndex('rss-extraction')).toBe(1);
    expect(getStepIndex('detail-extraction')).toBe(2);
  });

  it('case B: getStepDisplay uses dynamic total length (no hardcoded denominator)', () => {
    // Avoid `[3/18]` literal so middle-insertion does not break this test.
    expect(getStepDisplay('detail-extraction')).toBe(
      `[3/${PIPELINE_STEPS.length}] 公式サイト HTML 詳細抽出`,
    );
    // Independently lock-in the format shape via regex.
    expect(getStepDisplay('vision-api')).toMatch(
      /^\[\d+\/\d+\] Vision API 統合 \(条件付\)$/,
    );
  });

  it('case C: getStepLabel returns the label without bracket framing', () => {
    expect(getStepLabel('vision-api')).toBe('Vision API 統合 (条件付)');
    expect(getStepLabel('article-selection')).toBe('記事選別 (公式 URL 判定)');
  });

  it('case D: all PIPELINE_STEPS ids are unique', () => {
    const ids = PIPELINE_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('case E: all ids are non-empty kebab-case', () => {
    const kebabPattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;
    for (const step of PIPELINE_STEPS) {
      expect(step.id.length).toBeGreaterThan(0);
      expect(step.id).toMatch(kebabPattern);
      expect(step.label.length).toBeGreaterThan(0);
    }
  });

  it('current 18-step lineup is present (drift detector, not a hard count assert)', () => {
    // Smoke-check the 18 ids that the refactor migrated. Adding a new step
    // does NOT break this test because we only verify membership, not size.
    const expected = [
      'article-selection',
      'rss-extraction',
      'detail-extraction',
      'subpage-detection',
      'category-image-extraction',
      'vision-api',
      'slug-generation',
      'duplication-check',
      'metadata-generation',
      'title-generation',
      'content-generation',
      'image-upload-r2',
      'image-placeholder-replacement',
      'text-placeholder-replacement',
      'footer-placeholder-cleanup',
      'mdx-assembly',
      'github-pr-creation',
      'firestore-status-update',
    ];
    const actualIds = new Set(PIPELINE_STEPS.map((s) => s.id));
    for (const id of expected) {
      expect(actualIds.has(id)).toBe(true);
    }
  });
});
