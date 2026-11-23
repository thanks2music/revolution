import { describe, expect, it } from '@jest/globals';
import { resolveArticleEventType } from '@/lib/utils/article-event-type';

describe('resolveArticleEventType', () => {
  it('uses the kind the extraction chose', () => {
    expect(resolveArticleEventType({ primary_category_slug: 'chain-store' })).toEqual({
      ok: true,
      eventType: 'chain-store',
    });
  });

  it.each([
    ['a value outside the five kinds', { primary_category_slug: 'goods-sales' }, '"goods-sales"'],
    ['no kind', { event_slug: 'x' }, 'null'],
    ['no event_data', undefined, 'null'],
  ])('fails on %s instead of guessing', (_label, eventData, shown) => {
    const result = resolveArticleEventType(eventData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(`種別を判定できない (抽出結果の値: ${shown})`);
  });

  describe('updating a published article', () => {
    it("keeps the existing article's event_type (it is in the path) over a re-extraction that chose another", () => {
      expect(
        resolveArticleEventType(
          { primary_category_slug: 'pop-up-store' },
          { eventType: 'collabo-cafe' }
        )
      ).toEqual({ ok: true, eventType: 'collabo-cafe' });
    });

    it('fails when the existing value is outside the five kinds', () => {
      expect(resolveArticleEventType(undefined, { eventType: 'goods-sales' })).toEqual({
        ok: false,
        reason: '種別を判定できない (既存の記事の値: "goods-sales")',
      });
    });
  });
});
