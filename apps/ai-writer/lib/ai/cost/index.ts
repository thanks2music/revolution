/**
 * Cost Tracking Module
 *
 * @description
 * Provides LLM API cost calculation and tracking functionality.
 *
 * @example
 * ```typescript
 * import { getCostTrackerService, calculateCost, formatCost } from '@/lib/ai/cost';
 *
 * const tracker = getCostTrackerService();
 * tracker.recordUsage('step1', 'gpt-5-nano', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
 * tracker.logSummary();
 * ```
 */

export {
  // Types
  type ModelPricing,
  type TokenUsage,
  type CostResult,
  // Constants
  USD_TO_JPY_RATE,
  MODEL_PRICING,
  // Functions
  calculateCost,
  formatCost,
  getModelPricing,
  isKnownModel,
} from './model-pricing';

export {
  // Types
  type StepUsage,
  type CostSummary,
  // Class
  CostTrackerService,
  // Factory functions
  getCostTrackerService,
  createCostTracker,
} from './cost-tracker.service';
