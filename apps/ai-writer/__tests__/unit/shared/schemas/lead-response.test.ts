/**
 * Layer 1 tests for lead-response schema (Sprint C-β P11).
 *
 * Focus:
 * - LeadSlotsSchema: 4 スロット構造 (agent/verb/adjective/mediaForm/workTitle) の contract
 * - LeadGeneratorResultSchema: `LeadGeneratorService.generate()` 戻り値の shape validation
 * - LeadFallbackReasonEnum: Fallback 発火条件の enum 網羅
 */

import {
  LEAD_FALLBACK_TEMPLATE_ID,
  LeadFallbackReasonEnum,
  LeadGeneratorResultSchema,
  LeadSlotsSchema,
} from '@revolution/schemas/lead-response';

describe('LeadSlotsSchema (4 スロット構造、§vision doc §1)', () => {
  const validSlots = {
    agent: 'PEACH-PIT先生',
    verb: 'による',
    adjective: '人気',
    mediaForm: '漫画',
    workTitle: 'ローゼンメイデン',
  };

  it('accepts a fully-populated 4-slot structure', () => {
    const result = LeadSlotsSchema.safeParse(validSlots);
    expect(result.success).toBe(true);
  });

  it('accepts null for optional slots (agent/verb/adjective)', () => {
    const result = LeadSlotsSchema.safeParse({
      agent: null,
      verb: null,
      adjective: null,
      mediaForm: 'キャラクター',
      workTitle: 'サンリオ',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty mediaForm (required per §6.2)', () => {
    const result = LeadSlotsSchema.safeParse({ ...validSlots, mediaForm: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty workTitle (required)', () => {
    const result = LeadSlotsSchema.safeParse({ ...validSlots, workTitle: '' });
    expect(result.success).toBe(false);
  });

  it('rejects null mediaForm (required, cannot be null)', () => {
    const result = LeadSlotsSchema.safeParse({ ...validSlots, mediaForm: null });
    expect(result.success).toBe(false);
  });
});

describe('LeadGeneratorResultSchema', () => {
  const validResult = {
    leadMdx: '芥見下々先生による人気漫画「呪術廻戦」× BOX cafe&space 池袋店にて開催される。',
    usedTemplate: 'lead_author_with_characters',
    slots: {
      agent: '芥見下々先生',
      verb: 'による',
      adjective: '人気',
      mediaForm: '漫画',
      workTitle: '呪術廻戦',
    },
  };

  it('accepts a valid result without fallbackReason', () => {
    const result = LeadGeneratorResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it('accepts a valid result with fallbackReason (LLM Fallback fired)', () => {
    const result = LeadGeneratorResultSchema.safeParse({
      ...validResult,
      usedTemplate: LEAD_FALLBACK_TEMPLATE_ID,
      fallbackReason: 'output_too_short',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty leadMdx', () => {
    const result = LeadGeneratorResultSchema.safeParse({ ...validResult, leadMdx: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty usedTemplate', () => {
    const result = LeadGeneratorResultSchema.safeParse({ ...validResult, usedTemplate: '' });
    expect(result.success).toBe(false);
  });

  it('rejects malformed slots (missing mediaForm)', () => {
    const { slots, ...rest } = validResult;
    const result = LeadGeneratorResultSchema.safeParse({
      ...rest,
      slots: { agent: null, verb: null, adjective: null, workTitle: 'X' },
    });
    expect(result.success).toBe(false);
  });
});

describe('LeadFallbackReasonEnum', () => {
  it('covers all documented Fallback conditions', () => {
    const values = LeadFallbackReasonEnum.options;
    expect(values).toContain('all_conditions_missed');
    expect(values).toContain('too_many_unreplaced_placeholders');
    expect(values).toContain('output_too_short');
    expect(values).toContain('output_empty');
    expect(values).toContain('template_render_error');
  });

  it('rejects unknown reason strings', () => {
    const result = LeadFallbackReasonEnum.safeParse('unknown_reason');
    expect(result.success).toBe(false);
  });
});

describe('LEAD_FALLBACK_TEMPLATE_ID', () => {
  it('is the sentinel string for LLM Fallback', () => {
    expect(LEAD_FALLBACK_TEMPLATE_ID).toBe('__fallback__');
  });
});
