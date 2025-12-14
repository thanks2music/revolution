/**
 * Cost Tracker Service
 *
 * @description
 * Tracks LLM API costs across multiple steps in a pipeline.
 * Provides per-step and total cost aggregation.
 *
 * @example
 * ```typescript
 * const tracker = new CostTrackerService();
 *
 * // Record each API call
 * tracker.recordUsage('title_generation', 'gpt-5-nano', {
 *   promptTokens: 1000,
 *   completionTokens: 200,
 *   totalTokens: 1200,
 * });
 *
 * // Get summary at the end
 * tracker.logSummary();
 * ```
 */

import {
  calculateCost,
  formatCost,
  CostResult,
  TokenUsage,
  USD_TO_JPY_RATE,
} from './model-pricing';

export interface StepUsage {
  step: string;
  model: string;
  usage: TokenUsage;
  cost: CostResult;
  timestamp: Date;
}

export interface CostSummary {
  totalUsd: number;
  totalJpy: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  steps: StepUsage[];
}

/**
 * Cost Tracker Service
 *
 * Tracks LLM API costs across a pipeline execution.
 * Supports per-step tracking, aggregation, and summary logging.
 */
export class CostTrackerService {
  private steps: StepUsage[] = [];
  private articleId?: string;
  private startTime: Date;

  constructor(articleId?: string) {
    this.articleId = articleId;
    this.startTime = new Date();
  }

  /**
   * Record usage for a pipeline step
   *
   * @param step - Step identifier (e.g., 'Step1.5_Extraction')
   * @param model - Model name (e.g., 'gpt-5-nano')
   * @param usage - Token usage from API response
   * @returns Calculated cost for this step
   */
  recordUsage(step: string, model: string, usage: TokenUsage): CostResult {
    const cost = calculateCost(model, usage);

    this.steps.push({
      step,
      model,
      usage,
      cost,
      timestamp: new Date(),
    });

    // Log immediately
    this.logStepCost(step, model, usage, cost);

    return cost;
  }

  /**
   * Log cost for a single step
   */
  private logStepCost(
    step: string,
    model: string,
    usage: TokenUsage,
    cost: CostResult
  ): void {
    const tokens = usage.totalTokens.toLocaleString();
    const costStr = formatCost(cost);
    console.log(`💰 [${step}] ${model}: ${tokens} tokens | ${costStr}`);
  }

  /**
   * Get total cost summary
   */
  getSummary(): CostSummary {
    const totalUsd = this.steps.reduce((sum, s) => sum + s.cost.usd, 0);
    const totalTokens = this.steps.reduce((sum, s) => sum + s.usage.totalTokens, 0);
    const inputTokens = this.steps.reduce((sum, s) => sum + s.usage.promptTokens, 0);
    const outputTokens = this.steps.reduce((sum, s) => sum + s.usage.completionTokens, 0);

    return {
      totalUsd,
      totalJpy: totalUsd * USD_TO_JPY_RATE,
      totalTokens,
      inputTokens,
      outputTokens,
      steps: this.steps,
    };
  }

  /**
   * Log full summary to console
   */
  logSummary(): void {
    const summary = this.getSummary();
    const elapsedMs = Date.now() - this.startTime.getTime();
    const elapsedSec = (elapsedMs / 1000).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('💰 LLM API Cost Summary');
    if (this.articleId) {
      console.log(`📄 Article: ${this.articleId}`);
    }
    console.log(`⏱️  Elapsed: ${elapsedSec}s`);
    console.log('='.repeat(60));

    // Per-step breakdown
    if (this.steps.length > 0) {
      console.log('\n📊 Step-by-step breakdown:');
      for (const step of this.steps) {
        const costStr = formatCost(step.cost);
        const inputTokens = step.usage.promptTokens.toLocaleString();
        const outputTokens = step.usage.completionTokens.toLocaleString();
        console.log(`  [${step.step}]`);
        console.log(`    Model: ${step.model}`);
        console.log(`    Tokens: ${inputTokens} in / ${outputTokens} out`);
        console.log(`    Cost: ${costStr}`);
      }
    } else {
      console.log('\n📊 No API calls recorded.');
    }

    // Total
    console.log('\n' + '-'.repeat(60));
    console.log(`📈 Total tokens: ${summary.totalTokens.toLocaleString()}`);
    console.log(`   Input: ${summary.inputTokens.toLocaleString()} | Output: ${summary.outputTokens.toLocaleString()}`);
    console.log(`💵 Total cost: $${summary.totalUsd.toFixed(5)} (¥${summary.totalJpy.toFixed(2)})`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Get a compact one-line summary string
   */
  getCompactSummary(): string {
    const summary = this.getSummary();
    return `${summary.totalTokens.toLocaleString()} tokens | $${summary.totalUsd.toFixed(5)} (¥${summary.totalJpy.toFixed(2)})`;
  }

  /**
   * Reset tracker for new article
   *
   * @param articleId - Optional article identifier
   */
  reset(articleId?: string): void {
    this.steps = [];
    this.articleId = articleId;
    this.startTime = new Date();
  }

  /**
   * Get step count
   */
  getStepCount(): number {
    return this.steps.length;
  }

  /**
   * Check if any usage has been recorded
   */
  hasUsage(): boolean {
    return this.steps.length > 0;
  }

  /**
   * Get article ID if set
   */
  getArticleId(): string | undefined {
    return this.articleId;
  }
}

/** Singleton instance */
let _costTrackerInstance: CostTrackerService | null = null;

/**
 * Get singleton CostTrackerService instance
 *
 * @returns CostTrackerService singleton
 */
export function getCostTrackerService(): CostTrackerService {
  if (!_costTrackerInstance) {
    _costTrackerInstance = new CostTrackerService();
  }
  return _costTrackerInstance;
}

/**
 * Create a new CostTrackerService instance
 *
 * Use this when you need a separate tracker (e.g., for parallel processing)
 *
 * @param articleId - Optional article identifier
 * @returns New CostTrackerService instance
 */
export function createCostTracker(articleId?: string): CostTrackerService {
  return new CostTrackerService(articleId);
}
