/**
 * Layer 1 unit tests for `pipeline-steps.ts`.
 *
 * Verifies pure-function contracts on the pipeline-step SoT:
 * - id↔index mapping is stable in *relative* terms (absolute positions are
 *   intentionally not asserted because mid-array insertion is supported)
 * - display format embeds id and uses dynamic total length
 * - all ids are unique, non-empty kebab-case
 * - runtime throw guard fires when PIPELINE_STEPS has drifted
 */

import { describe, it, expect } from '@jest/globals';
import {
  PIPELINE_STEPS,
  getStepIndex,
  getStepDisplay,
  getStepLabel,
  getStepContext,
  type PipelineStepId,
} from '@/lib/services/pipeline-steps';

describe('pipeline-steps — Layer 1 contracts', () => {
  it('case A: getStepIndex preserves the documented relative ordering of known ids', () => {
    // Mid-array insertion is a supported operation per the architecture doc,
    // so we assert ordering relationships rather than absolute positions.
    expect(getStepIndex('article-selection')).toBeLessThan(getStepIndex('rss-extraction'));
    expect(getStepIndex('rss-extraction')).toBeLessThan(getStepIndex('detail-extraction'));
    expect(getStepIndex('vision-api')).toBeLessThan(getStepIndex('slug-generation'));
    expect(getStepIndex('content-generation')).toBeLessThan(getStepIndex('mdx-assembly'));
  });

  it('case B: getStepDisplay embeds id and uses live index/length (no hardcoded position)', () => {
    // Compute the expected numerator from the live index so this test survives
    // mid-array insertion. Format embeds the stable id for log grepability.
    const id: PipelineStepId = 'detail-extraction';
    const expectedIndex = getStepIndex(id) + 1;
    expect(getStepDisplay(id)).toBe(
      `[${expectedIndex}/${PIPELINE_STEPS.length} ${id}] 公式サイト HTML 詳細抽出`,
    );
    // Independently lock-in the overall format shape via regex.
    expect(getStepDisplay('vision-api')).toMatch(
      /^\[\d+\/\d+ vision-api\] Vision API 統合 \(条件付\)$/,
    );
  });

  it('case C: getStepLabel returns the label without bracket framing', () => {
    expect(getStepLabel('vision-api')).toBe('Vision API 統合 (条件付)');
    expect(getStepLabel('article-selection')).toBe('記事選別 (公式 URL 判定)');
  });

  it('getStepContext returns [id] for sub-context log lines', () => {
    expect(getStepContext('vision-api')).toBe('[vision-api]');
    expect(getStepContext('image-upload-r2')).toBe('[image-upload-r2]');
  });

  it('getStepContext appends sub-label as [id: sub-label] when provided', () => {
    expect(getStepContext('image-upload-r2', 'OG')).toBe('[image-upload-r2: OG]');
    expect(getStepContext('metadata-generation', '開催都道府県')).toBe(
      '[metadata-generation: 開催都道府県]',
    );
  });

  it('getStepIndex throws for an id absent from PIPELINE_STEPS (drift guard)', () => {
    // PipelineStepId normally blocks this at compile time, so the runtime
    // guard only fires when a caller bypasses the type via cast or when
    // PIPELINE_STEPS itself has drifted. Lock in the message shape.
    expect(() => getStepIndex('nonexistent-step' as PipelineStepId)).toThrow(
      /Unknown pipeline step id: nonexistent-step/,
    );
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
