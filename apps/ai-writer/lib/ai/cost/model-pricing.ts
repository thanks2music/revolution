/**
 * LLM Model Pricing Definitions
 *
 * @description
 * OpenAI / Anthropic / Gemini pricing definitions
 * Standard tier pricing (per 1M tokens)
 *
 * @see https://openai.com/api/pricing/
 * @see https://www.anthropic.com/pricing
 * @see https://ai.google.dev/pricing
 *
 * Last updated: 2026-06-07
 */

export interface ModelPricing {
  /** Input tokens price per 1M tokens (USD) */
  inputPer1M: number;
  /** Cached input tokens price per 1M tokens (USD) */
  cachedInputPer1M?: number;
  /** Output tokens price per 1M tokens (USD) */
  outputPer1M: number;
  /** Provider name */
  provider: 'openai' | 'anthropic' | 'gemini';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens served from a prior prompt-cache write (priced at cachedInputPer1M, ~0.1x base). */
  cachedTokens?: number;
  /**
   * Tokens written to the prompt cache on this call (priced at base * 1.25 for 5m TTL).
   * 1h TTL is not supported.
   */
  cacheCreationTokens?: number;
}

export interface CostResult {
  /** Cost in USD */
  usd: number;
  /** Cost in JPY (reference, using fixed rate) */
  jpy: number;
  /** Breakdown by token type */
  breakdown: {
    inputCost: number;
    outputCost: number;
    cachedCost: number;
    cacheCreationCost: number;
  };
}

/** Anthropic prompt-cache write multiplier for 5m TTL ephemeral cache (1.25x base input). */
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;

/** USD to JPY conversion rate (reference only) */
export const USD_TO_JPY_RATE = 150;

/**
 * Model pricing table (Standard tier, per 1M tokens)
 * Last updated: 2026-06-07
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI GPT-5.4 / 5.5 series (added 2026-06-07, sourced from https://developers.openai.com/api/docs/models)
  'gpt-5.5': {
    inputPer1M: 5.0,
    cachedInputPer1M: 0.5,
    outputPer1M: 30.0,
    provider: 'openai',
  },
  'gpt-5.4': {
    inputPer1M: 2.5,
    cachedInputPer1M: 0.25,
    outputPer1M: 15.0,
    provider: 'openai',
  },
  'gpt-5.4-mini': {
    inputPer1M: 0.75,
    cachedInputPer1M: 0.075,
    outputPer1M: 4.5,
    provider: 'openai',
  },
  'gpt-5.4-nano': {
    inputPer1M: 0.2,
    cachedInputPer1M: 0.02,
    outputPer1M: 1.25,
    provider: 'openai',
  },
  // OpenAI GPT-5 (initial) series — retained for backward compatibility with historical cost logs
  'gpt-5-nano': {
    inputPer1M: 0.05,
    cachedInputPer1M: 0.005,
    outputPer1M: 0.4,
    provider: 'openai',
  },
  'gpt-5-mini': {
    inputPer1M: 0.25,
    cachedInputPer1M: 0.025,
    outputPer1M: 2.0,
    provider: 'openai',
  },
  // OpenAI GPT-4.1 series — gpt-4.1-nano removed 2026-06-07 (shutdown 2026-10-23, replaced by gpt-5.4-nano)
  'gpt-4.1-mini': {
    inputPer1M: 0.4,
    cachedInputPer1M: 0.1,
    outputPer1M: 1.6,
    provider: 'openai',
  },
  // OpenAI GPT-4o series
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    cachedInputPer1M: 0.075,
    outputPer1M: 0.6,
    provider: 'openai',
  },
  'gpt-4o': {
    inputPer1M: 2.5,
    cachedInputPer1M: 1.25,
    outputPer1M: 10.0,
    provider: 'openai',
  },
  // Anthropic Claude series
  'claude-sonnet-4-5-20250514': {
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    outputPer1M: 15.0,
    provider: 'anthropic',
  },
  'claude-sonnet-4-5-20250929': {
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    outputPer1M: 15.0,
    provider: 'anthropic',
  },
  'claude-3-5-haiku-20241022': {
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    outputPer1M: 4.0,
    provider: 'anthropic',
  },
  'claude-3-5-sonnet-20241022': {
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    outputPer1M: 15.0,
    provider: 'anthropic',
  },
  // Google Gemini series
  'gemini-2.0-flash': {
    inputPer1M: 0.1,
    outputPer1M: 0.4,
    provider: 'gemini',
  },
  'gemini-2.5-flash': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    provider: 'gemini',
  },
  'gemini-1.5-flash': {
    inputPer1M: 0.075,
    outputPer1M: 0.3,
    provider: 'gemini',
  },
  'gemini-1.5-pro': {
    inputPer1M: 1.25,
    outputPer1M: 5.0,
    provider: 'gemini',
  },
};

/**
 * Calculate cost for given model and token usage
 *
 * @param model - Model name (e.g., 'gpt-5-nano')
 * @param usage - Token usage from API response
 * @returns Calculated cost in USD and JPY
 */
export function calculateCost(model: string, usage: TokenUsage): CostResult {
  const pricing = MODEL_PRICING[model];

  if (!pricing) {
    console.warn(`[CostTracker] Unknown model: ${model}, using gpt-4o-mini pricing as fallback`);
    return calculateCost('gpt-4o-mini', usage);
  }

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1M;
  const cachedCost = usage.cachedTokens
    ? (usage.cachedTokens / 1_000_000) * (pricing.cachedInputPer1M || pricing.inputPer1M)
    : 0;
  const cacheCreationCost = usage.cacheCreationTokens
    ? (usage.cacheCreationTokens / 1_000_000) * pricing.inputPer1M * CACHE_WRITE_5M_MULTIPLIER
    : 0;

  const totalUsd = inputCost + outputCost + cachedCost + cacheCreationCost;

  return {
    usd: totalUsd,
    jpy: totalUsd * USD_TO_JPY_RATE,
    breakdown: {
      inputCost,
      outputCost,
      cachedCost,
      cacheCreationCost,
    },
  };
}

/**
 * Format cost for display
 *
 * @param cost - Cost result object
 * @returns Formatted string like "$0.00012 (¥0.02)"
 */
export function formatCost(cost: CostResult): string {
  const usdStr = cost.usd < 0.01 ? `$${cost.usd.toFixed(5)}` : `$${cost.usd.toFixed(4)}`;
  const jpyStr = `¥${cost.jpy.toFixed(2)}`;
  return `${usdStr} (${jpyStr})`;
}

/**
 * Get pricing info for a model
 *
 * @param model - Model name
 * @returns Pricing info or undefined if not found
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING[model];
}

/**
 * Check if a model is known in the pricing table
 *
 * @param model - Model name
 * @returns True if model pricing is defined
 */
export function isKnownModel(model: string): boolean {
  return model in MODEL_PRICING;
}
