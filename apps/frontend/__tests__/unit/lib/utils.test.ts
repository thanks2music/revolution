import { describe, expect, it } from '@jest/globals';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui の部品は `className` で既定の class を上書きできる前提で作られている
 * (後に書いた class が、同じ性質の前の class に勝つ)。`cn` パッケージ
 * (clsx + tailwind-merge の置き換え) がその前提を満たすことを、Tailwind v4 の class で固定する。
 */
describe('cn', () => {
  it('drops falsy values and joins the rest', () => {
    expect(cn('px-2', false, undefined, null, 'py-1')).toBe('px-2 py-1');
  });

  it('lets a later class override a conflicting earlier one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('bg-primary text-primary-foreground', 'bg-muted')).toBe(
      'text-primary-foreground bg-muted'
    );
  });

  it('understands Tailwind v4 class names used by the shadcn components', () => {
    expect(cn('ring-3', 'ring-1')).toBe('ring-1');
    expect(cn('rounded-lg', 'rounded-[min(var(--radius-md),10px)]')).toBe(
      'rounded-[min(var(--radius-md),10px)]'
    );
    expect(cn('shadow-xs', 'shadow-none')).toBe('shadow-none');
  });
});
