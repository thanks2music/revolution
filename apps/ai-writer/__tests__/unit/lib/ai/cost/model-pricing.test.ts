/**
 * Layer 1 unit tests for `calculateCost` covering prompt-cache pricing.
 *
 * Pricing assumptions (per `model-pricing.ts` / Anthropic public pricing):
 * - claude-sonnet-4-5-20250929: input $3.00/1M, cachedInput $0.30/1M, output $15.00/1M
 * - cache creation (5m TTL ephemeral): inputPer1M * 1.25 = $3.75/1M
 */

import { describe, it, expect } from '@jest/globals';
import {
  calculateCost,
  formatCost,
  CACHE_WRITE_5M_MULTIPLIER,
  type TokenUsage,
} from '@/lib/ai/cost/model-pricing';

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const CLAUDE_INPUT_PER_M = 3.0;
const CLAUDE_CACHED_INPUT_PER_M = 0.3;
const CLAUDE_OUTPUT_PER_M = 15.0;

describe('calculateCost — prompt cache pricing', () => {
  it('calculates regular input + output cost (baseline, no cache)', () => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    expect(cost.breakdown.inputCost).toBeCloseTo(CLAUDE_INPUT_PER_M, 5);
    expect(cost.breakdown.outputCost).toBeCloseTo(CLAUDE_OUTPUT_PER_M, 5);
    expect(cost.breakdown.cachedCost).toBe(0);
    expect(cost.breakdown.cacheCreationCost).toBe(0);
    expect(cost.usd).toBeCloseTo(CLAUDE_INPUT_PER_M + CLAUDE_OUTPUT_PER_M, 5);
  });

  it('applies 1.25x multiplier when only cacheCreationTokens are present', () => {
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationTokens: 1_000_000,
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    const expectedCacheCreationCost = CLAUDE_INPUT_PER_M * CACHE_WRITE_5M_MULTIPLIER;
    expect(cost.breakdown.cacheCreationCost).toBeCloseTo(expectedCacheCreationCost, 5);
    expect(cost.breakdown.inputCost).toBe(0);
    expect(cost.breakdown.cachedCost).toBe(0);
    expect(cost.usd).toBeCloseTo(expectedCacheCreationCost, 5);
  });

  it('applies cachedInputPer1M (0.1x) when only cachedTokens are present', () => {
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 1_000_000,
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    expect(cost.breakdown.cachedCost).toBeCloseTo(CLAUDE_CACHED_INPUT_PER_M, 5);
    expect(cost.breakdown.cacheCreationCost).toBe(0);
    expect(cost.breakdown.inputCost).toBe(0);
    expect(cost.usd).toBeCloseTo(CLAUDE_CACHED_INPUT_PER_M, 5);
  });

  it('sums regular input + cache creation + cache read independently', () => {
    const usage: TokenUsage = {
      promptTokens: 500_000,         // regular @ $3/M = $1.50
      completionTokens: 100_000,     // output @ $15/M = $1.50
      totalTokens: 600_000,
      cacheCreationTokens: 200_000,  // cache write @ $3.75/M = $0.75
      cachedTokens: 800_000,         // cache read @ $0.30/M = $0.24
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    expect(cost.breakdown.inputCost).toBeCloseTo(1.5, 5);
    expect(cost.breakdown.outputCost).toBeCloseTo(1.5, 5);
    expect(cost.breakdown.cacheCreationCost).toBeCloseTo(0.75, 5);
    expect(cost.breakdown.cachedCost).toBeCloseTo(0.24, 5);
    expect(cost.usd).toBeCloseTo(1.5 + 1.5 + 0.75 + 0.24, 5);
  });

  it('exposes breakdown.cacheCreationCost as 0 when no cache tokens are passed', () => {
    const cost = calculateCost(CLAUDE_MODEL, {
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
    });

    expect(cost.breakdown).toHaveProperty('cacheCreationCost');
    expect(cost.breakdown.cacheCreationCost).toBe(0);
  });

  it('falls back to gpt-4o-mini pricing for unknown models', () => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    };

    const cost = calculateCost('non-existent-model-xyz', usage);

    // gpt-4o-mini: inputPer1M = 0.15
    expect(cost.breakdown.inputCost).toBeCloseTo(0.15, 5);
  });

  it('treats cacheCreationTokens=0 as no-op (does not synthesize cost)', () => {
    const cost = calculateCost(CLAUDE_MODEL, {
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      cacheCreationTokens: 0,
    });

    expect(cost.breakdown.cacheCreationCost).toBe(0);
  });

  it('formats cost with cache creation included in usd total (formatCost lock-in)', () => {
    const cost = calculateCost(CLAUDE_MODEL, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationTokens: 1_000_000,
    });

    const formatted = formatCost(cost);
    // $3.75 falls in the >= $0.01 branch, so 4-decimal format
    expect(formatted).toMatch(/^\$3\.7500 \(¥\d/);
  });

  describe('GPT-5.4 / 5.5 pricing (added 2026-06-07)', () => {
    it('calculates input + output cost for gpt-5.4-mini (default model post 2026-06-07)', () => {
      // gpt-5.4-mini: input $0.75/M, cachedInput $0.075/M, output $4.50/M
      const usage: TokenUsage = {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
      };

      const cost = calculateCost('gpt-5.4-mini', usage);

      expect(cost.breakdown.inputCost).toBeCloseTo(0.75, 5);
      expect(cost.breakdown.outputCost).toBeCloseTo(4.5, 5);
      expect(cost.breakdown.cachedCost).toBe(0);
      expect(cost.usd).toBeCloseTo(5.25, 5);
    });

    it('applies cached input pricing for gpt-5.5 (premium tier)', () => {
      // gpt-5.5: input $5.00/M, cachedInput $0.50/M, output $30.00/M
      const usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 1_000_000,
      };

      const cost = calculateCost('gpt-5.5', usage);

      expect(cost.breakdown.cachedCost).toBeCloseTo(0.5, 5);
      expect(cost.breakdown.inputCost).toBe(0);
      expect(cost.breakdown.outputCost).toBe(0);
      expect(cost.usd).toBeCloseTo(0.5, 5);
    });
  });
});
