/**
 * Vision API Integration Type Definitions
 *
 * @description
 * Type definitions for Vision API YAML template (1.5-vision-extraction.yaml)
 * and related data structures for OpenAI Vision API integration.
 *
 * @package revolution
 * @module types/vision-api
 */

/**
 * Vision API YAML Template Structure
 *
 * @description
 * Represents the complete structure of 1.5-vision-extraction.yaml
 */
export interface VisionApiTemplate {
  /** Template metadata */
  version: string;
  name: string;
  description: string;

  /** Metadata for pipeline integration */
  metadata: {
    phase: string;
    order: number;
    requires: string[];
    outputs: string[];
  };

  /** Conditional trigger logic */
  conditions: {
    trigger: {
      description: string;
      logic: string;
    };
  };

  /** AI prompts for each category */
  prompts: {
    menu_extraction: VisionPrompt;
    goods_extraction: VisionPrompt;
    novelty_extraction: VisionPrompt;
  };

  /** Output schema definition */
  output_schema: VisionOutputSchema;

  /** Fallback strategy (Level A/B/C) */
  fallback: VisionFallbackStrategy;

  /** Business rules for validation */
  business_rules: VisionBusinessRules;

  /** Pipeline integration steps */
  pipeline_integration: VisionPipelineIntegration;

  /** Error handling configuration */
  error_handling: VisionErrorHandling;

  /** Monitoring configuration */
  monitoring: VisionMonitoring;
}

/**
 * Vision API Prompt Structure
 */
export interface VisionPrompt {
  /** Prompt description */
  description: string;

  /** Prompt content (sent to Vision API) */
  content: string;

  /** Expected response structure */
  response_schema?: string;
}

/**
 * Vision API Output Schema
 */
export interface VisionOutputSchema {
  type: 'object';
  required: string[];
  properties: {
    visionExtraction: {
      type: 'object';
      required: string[];
      properties: {
        confidence: {
          type: 'number';
          minimum: number;
          maximum: number;
          description: string;
        };
        provider: {
          type: 'string';
          enum: ['openai', 'claude'];
          description: string;
        };
        timestamp: {
          type: 'string';
          format: 'date-time';
          description: string;
        };
        menuItems: {
          type: 'array';
          items: {
            type: 'object';
            properties: Record<string, unknown>;
          };
        };
        goodsItems: {
          type: 'array';
          items: {
            type: 'object';
            properties: Record<string, unknown>;
          };
        };
        noveltyItems: {
          type: 'array';
          items: {
            type: 'object';
            properties: Record<string, unknown>;
          };
        };
        metadata?: {
          type: 'object';
          properties: {
            hasComingSoonNotice?: {
              type: 'boolean';
              description: string;
            };
            totalImagesAnalyzed?: {
              type: 'number';
              description: string;
            };
          };
        };
      };
    };
  };
}

/**
 * Vision Extraction Result (TypeScript type matching output_schema)
 */
export interface VisionExtractionResult {
  visionExtraction: {
    /** Confidence score (0.0-1.0) */
    confidence: number;

    /** Provider used (openai or claude) */
    provider: 'openai' | 'claude';

    /** Extraction timestamp */
    timestamp: string;

    /** Extracted menu items */
    menuItems: MenuItem[];

    /** Extracted goods items */
    goodsItems: GoodsItem[];

    /** Extracted novelty items (array) */
    noveltyItems: NoveltyItem[];

    /** Optional metadata */
    metadata?: {
      /** Whether "Coming Soon" notice was detected */
      hasComingSoonNotice?: boolean;

      /** Total images analyzed */
      totalImagesAnalyzed?: number;
    };
  };
}

/**
 * Menu Item Structure
 */
export interface MenuItem {
  /** Menu item name (as written in the image, exact text) */
  name: string;

  /** Price (tax-included preferred) */
  price?: number;

  /** Character names (array, empty array if no characters) */
  characterName: string[];

  /** Bonus/novelty information */
  bonus?: string;

  /** Description */
  description?: string;

  /** Notes (e.g., food allergy information) */
  notes?: string;

  /** Remarks (e.g., ingredients, nutritional information) */
  remarks?: string;

  /** Confidence score for this item (0.0-1.0) */
  confidence?: number;
}

/**
 * Goods Item Structure
 */
export interface GoodsItem {
  /** Goods item name */
  name: string;

  /** Price */
  price?: number;

  /** Number of variants */
  variantCount?: number;

  /** Variant details (e.g., "全6種") */
  variantDetails?: string;

  /** Character names (array, empty array if no characters) */
  characterName: string[];
}

/**
 * Novelty Item Structure
 */
export interface NoveltyItem {
  /** Novelty item name */
  name: string;

  /** Condition to receive (e.g., "1ドリンク注文につき1枚ランダム配布") */
  condition?: string;

  /** Number of variants */
  variantCount?: number;

  /** Character names (array, empty array if no characters) */
  characterName: string[];

  /** Notes (e.g., "絵柄は選べません") */
  notes?: string;

  /** Remarks (e.g., "無くなり次第終了") */
  remarks?: string;
}

/**
 * Fallback Strategy (Level A/B/C)
 */
export interface VisionFallbackStrategy {
  level_a: FallbackLevel;
  level_b: FallbackLevel;
  level_c: FallbackLevel;
}

/**
 * Fallback Level Definition
 */
export interface FallbackLevel {
  /** Trigger conditions (array of string conditions) */
  trigger: string[];

  /** Template to use when triggered */
  template: string;

  /** Optional description */
  description?: string;
}

/**
 * Business Rules for Validation
 */
export interface VisionBusinessRules {
  price_validation: {
    menu: {
      min: number;
      max: number;
      description: string;
    };
    goods: {
      min: number;
      max: number;
      description: string;
    };
  };

  variant_count_validation: {
    goods: {
      max: number;
      description: string;
    };
    novelty: {
      max: number;
      description: string;
    };
  };

  category_classification: {
    menu_keywords: string[];
    goods_keywords: string[];
    novelty_keywords: string[];
  };
}

/**
 * Pipeline Integration Steps
 */
export interface VisionPipelineIntegration {
  step_1: PipelineStep;
  step_2: PipelineStep;
  step_3: PipelineStep;
  step_4: PipelineStep;
  step_5: PipelineStep;
}

/**
 * Pipeline Step Definition
 */
export interface PipelineStep {
  name: string;
  description: string;
  implementation?: string;
}

/**
 * Error Handling Configuration
 */
export interface VisionErrorHandling {
  vision_api_failure: ErrorAction;
  hallucination_detected: ErrorAction;
  invalid_json_response: ErrorAction;
  rate_limit_exceeded: ErrorAction;
}

/**
 * Error Action Definition
 */
export interface ErrorAction {
  action: string;
  description?: string;
}

/**
 * Monitoring Configuration
 */
export interface VisionMonitoring {
  metrics: MonitoringMetric[];
}

/**
 * Monitoring Metric Definition
 */
export interface MonitoringMetric {
  name: string;
  threshold: string;
  description: string;
}

/**
 * Fallback Level Type
 */
export type FallbackLevelType = 'A' | 'B' | 'C';

/**
 * Cross-Check Result
 */
export interface CrossCheckResult {
  /** Whether cross-check passed */
  passed: boolean;

  /** Issues detected (empty if passed) */
  issues: string[];

  /** Cross-check details */
  details: {
    htmlMenuCount: number;
    visionMenuCount: number;
    htmlPriceCount: number;
    visionPriceCount: number;
    hasComingSoonNotice: boolean;
    confidenceScore: number;
  };
}

/**
 * Hallucination Detection Result
 */
export interface HallucinationDetectionResult {
  /** Whether hallucination was detected */
  detected: boolean;

  /** Hallucination type (if detected) */
  type?: 'coming_soon_fabrication' | 'excessive_detail_without_html' | 'confidence_inconsistency';

  /** Detection reason */
  reason?: string;

  /** Confidence score that triggered detection */
  confidence?: number;
}

/**
 * Vision API Provider Type
 *
 * @description
 * Supported Vision API providers for dual-provider architecture.
 */
export type VisionProvider = 'openai' | 'claude';

/**
 * Vision API Configuration
 *
 * @description
 * Configuration options for Vision API service initialization.
 * Used by VisionApiServiceFactory to create provider-specific implementations.
 */
export interface VisionApiConfig {
  /** Provider to use (openai or claude) */
  provider: VisionProvider;

  /** API key (optional, defaults to environment variable) */
  apiKey?: string;

  /** Model name override (optional, defaults to provider-specific default) */
  model?: string;

  /** Detail level for OpenAI (optional, defaults to 'high') */
  detail?: 'low' | 'high' | 'auto';

  /** Max tokens (optional, defaults to 4096) */
  maxTokens?: number;

  /** Temperature (optional, defaults to 0.1) */
  temperature?: number;
}

/**
 * Token Calculation Result
 *
 * @description
 * Result of token calculation for Vision API calls.
 * Provides detailed breakdown and cost estimation.
 */
export interface TokenCalculationResult {
  /** Provider used for calculation */
  provider: VisionProvider;

  /** Total tokens consumed */
  totalTokens: number;

  /** Token calculation breakdown */
  breakdown: {
    /** Image tokens */
    imageTokens: number;

    /** Prompt tokens */
    promptTokens: number;

    /** Completion tokens (if available) */
    completionTokens?: number;
  };

  /** Cost estimation in USD */
  estimatedCost: number;
}

/**
 * Vision API Service Interface
 *
 * @description
 * Abstract interface for Vision API service implementations.
 * Both OpenAI and Claude implementations must conform to this interface.
 *
 * @example
 * ```typescript
 * const service: IVisionApiService = VisionApiServiceFactory.create('openai');
 * const result = await service.extractFromImages({
 *   imageUrls: ['https://example.com/menu.jpg'],
 *   prompt: 'Extract menu items',
 *   category: 'menu'
 * });
 * ```
 */
export interface IVisionApiService {
  /**
   * Extract menu/goods/novelty information from images
   *
   * @param options - Vision API call options
   * @returns Extraction result with menu/goods/novelty items
   */
  extractFromImages(options: VisionApiCallOptions): Promise<VisionExtractionResult>;

  /**
   * Get provider name
   *
   * @returns Provider name ('openai' or 'claude')
   */
  getProviderName(): VisionProvider;

  /**
   * Calculate tokens for image analysis
   *
   * @param imageUrls - Array of image URLs to analyze
   * @returns Token calculation result with cost estimation
   */
  calculateTokens(imageUrls: string[]): Promise<TokenCalculationResult>;
}

/**
 * Vision API Call Options (Extended)
 *
 * @description
 * Extended options for Vision API calls with provider-specific parameters.
 */
export interface VisionApiCallOptions {
  /** Image URLs to analyze */
  imageUrls: string[];

  /** Prompt for extraction */
  prompt: string;

  /** Category being extracted (menu, goods, novelty) */
  category: 'menu' | 'goods' | 'novelty';

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Provider override (optional, defaults to config) */
  provider?: VisionProvider;

  /** Detail level for OpenAI (optional, defaults to 'high') */
  detail?: 'low' | 'high' | 'auto';
}
