/**
 * Layer 1 unit tests for `resolveVisionPrompt`.
 *
 * Verifies category → prompt mapping for the YAML-loaded VisionApiTemplate.
 */

import {
  resolveVisionPrompt,
  UnknownVisionCategoryError,
} from '@/lib/services/vision-api/category-prompt-resolver';
import type { VisionApiTemplate } from '@/lib/types/vision-api';

function buildTemplate(): VisionApiTemplate {
  // Minimal template: only the fields used by `resolveVisionPrompt`. Other
  // template properties are cast through `unknown` so the test stays focused
  // on the prompt-key contract.
  return {
    prompts: {
      menu_extraction: {
        description: 'menu',
        content: 'MENU PROMPT BODY',
      },
      goods_extraction: {
        description: 'goods',
        content: 'GOODS PROMPT BODY',
      },
      novelty_extraction: {
        description: 'novelty',
        content: 'NOVELTY PROMPT BODY',
      },
    },
  } as unknown as VisionApiTemplate;
}

describe('resolveVisionPrompt', () => {
  it('returns the menu_extraction prompt for category="menu"', () => {
    expect(resolveVisionPrompt(buildTemplate(), 'menu')).toBe('MENU PROMPT BODY');
  });

  it('returns the goods_extraction prompt for category="goods"', () => {
    expect(resolveVisionPrompt(buildTemplate(), 'goods')).toBe('GOODS PROMPT BODY');
  });

  it('returns the novelty_extraction prompt for category="novelty"', () => {
    expect(resolveVisionPrompt(buildTemplate(), 'novelty')).toBe('NOVELTY PROMPT BODY');
  });

  it('throws UnknownVisionCategoryError when the prompt entry is missing', () => {
    const broken = {
      prompts: {
        menu_extraction: { description: 'menu', content: 'MENU' },
        goods_extraction: { description: 'goods', content: 'GOODS' },
        // novelty_extraction missing — defensive check beyond loader validation
      },
    } as unknown as VisionApiTemplate;

    expect(() => resolveVisionPrompt(broken, 'novelty')).toThrow(
      UnknownVisionCategoryError,
    );
  });
});
