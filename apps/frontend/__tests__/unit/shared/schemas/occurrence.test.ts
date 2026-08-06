import { describe, expect, it } from '@jest/globals';

import {
  OCCURRENCE_SLUG_REGEX,
  OCCURRENCE_STATUS_VALUES,
  OccurrenceInsertSchema,
  OccurrenceStatusSchema,
  OccurrenceViewSchema,
} from '@revolution/schemas/occurrence';

const base = {
  eventId: 1,
  slug: 'tokyo-omotesando',
  startsOn: '2026-08-01',
};

describe('OccurrenceInsertSchema', () => {
  it('accepts the minimal shape (event_id + slug + starts_on)', () => {
    expect(() => OccurrenceInsertSchema.parse(base)).not.toThrow();
  });

  it('accepts a fully populated occurrence', () => {
    expect(() =>
      OccurrenceInsertSchema.parse({
        ...base,
        venueId: 10,
        venueLabel: '渋谷パルコ 4F',
        endsOn: '2026-09-30',
        verified: true,
      }),
    ).not.toThrow();
  });

  it('accepts venue_id = null (online-only run)', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, venueId: null })).not.toThrow();
  });

  // ★決定⑤: ends_on nullable = 終了日未定 / 常設。
  it('accepts ends_on = null (open-ended / permanent run)', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, endsOn: null })).not.toThrow();
  });

  it('accepts an omitted ends_on', () => {
    expect(() => OccurrenceInsertSchema.parse(base)).not.toThrow();
  });

  // ★決定③: slug は NOT NULL。採番できない記事は occurrence を作らない。
  it('rejects a missing slug', () => {
    const { slug: _slug, ...withoutSlug } = base;
    expect(() => OccurrenceInsertSchema.parse(withoutSlug)).toThrow();
  });

  it('rejects slug = null', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, slug: null })).toThrow();
  });

  it.each([
    ['uppercase', 'Tokyo-Omotesando'],
    ['japanese chars', '渋谷パルコ'],
    ['leading hyphen', '-tokyo'],
    ['trailing hyphen', 'tokyo-'],
    ['consecutive hyphens', 'tokyo--omotesando'],
    ['underscore', 'tokyo_omotesando'],
    ['space', 'tokyo omotesando'],
    ['empty', ''],
  ])('rejects slug with %s', (_label, slug) => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, slug })).toThrow();
  });

  it.each([
    ['single segment', 'shibuya'],
    ['digits', 'parco2026'],
    ['multi segment', 'tokyo-omotesando-hills-b3'],
  ])('accepts slug with %s', (_label, slug) => {
    expect(OCCURRENCE_SLUG_REGEX.test(slug)).toBe(true);
    expect(() => OccurrenceInsertSchema.parse({ ...base, slug })).not.toThrow();
  });

  it.each([
    ['non-ISO format', '2026/08/01'],
    ['no zero padding', '2026-8-1'],
    ['free text', 'August 1, 2026'],
  ])('rejects starts_on with %s', (_label, startsOn) => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, startsOn })).toThrow();
  });

  // `z.iso.date()` は単純な regex と違い暦の妥当性まで見る。
  it.each([
    ['month out of range', '2026-13-01'],
    ['day out of range', '2026-08-45'],
    ['non-existent day for the month', '2026-02-30'],
  ])('rejects starts_on with %s', (_label, startsOn) => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, startsOn })).toThrow();
  });

  it('accepts a real leap day', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, startsOn: '2028-02-29' })).not.toThrow();
  });

  it('rejects a leap day in a non-leap year', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, startsOn: '2026-02-29' })).toThrow();
  });

  it('rejects a non-ISO ends_on', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, endsOn: '2026/09/30' })).toThrow();
  });

  it('rejects an ends_on that is not a real calendar date', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, endsOn: '2026-02-30' })).toThrow();
  });

  it('rejects a whitespace-only venue_label', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, venueLabel: '   ' })).toThrow();
  });

  // Layer 1 は ASCII 空白しか trim しないが、Layer 2 の DB CHECK が
  // Unicode-aware な btrim で U+3000 を弾く (二段防御)。
  it('rejects a venue_label of only full-width spaces', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, venueLabel: '　　' })).toThrow();
  });

  it('accepts venue_label = null', () => {
    expect(() => OccurrenceInsertSchema.parse({ ...base, venueLabel: null })).not.toThrow();
  });

  // ★決定⑧: verified は RLS の公開判定が依存する。
  // Layer 1 は **既定値を補完しない** — DB 側に `default false` があるため
  // drizzle-zod は「任意」として扱うだけで、省略すると undefined のまま返る。
  // false を保証しているのは Layer 2 の `default false` の方。
  // (旧テストは `parsed.verified ?? false` で assert しており、undefined でも
  //  通ってしまう緩さがあった。2026-08-06 claude[bot] 指摘で厳密化)
  it('leaves verified unset rather than fabricating a default', () => {
    const parsed = OccurrenceInsertSchema.parse(base);
    expect(parsed.verified).toBeUndefined();
  });

  it('passes an explicit verified through unchanged', () => {
    expect(OccurrenceInsertSchema.parse({ ...base, verified: true }).verified).toBe(true);
    expect(OccurrenceInsertSchema.parse({ ...base, verified: false }).verified).toBe(false);
  });
});

describe('OccurrenceStatusSchema', () => {
  it('exposes exactly the four states derived by occurrence_view', () => {
    expect([...OCCURRENCE_STATUS_VALUES]).toEqual([
      'scheduled',
      'ongoing',
      'ended',
      'cancelled',
    ]);
  });

  it.each(OCCURRENCE_STATUS_VALUES)('accepts %s', (status) => {
    expect(() => OccurrenceStatusSchema.parse(status)).not.toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => OccurrenceStatusSchema.parse('postponed')).toThrow();
  });
});

describe('OccurrenceViewSchema', () => {
  const viewRow = {
    id: 1,
    eventId: 1,
    venueId: 10,
    venueLabel: null,
    slug: 'tokyo-omotesando',
    startsOn: '2026-08-01',
    endsOn: null,
    cancelledAt: null,
    verified: true,
    ratingSum: 0,
    ratingCount: 0,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    status: 'ongoing' as const,
  };

  it('accepts a view row carrying the derived status', () => {
    expect(() => OccurrenceViewSchema.parse(viewRow)).not.toThrow();
  });

  it('rejects a view row without status', () => {
    const { status: _status, ...withoutStatus } = viewRow;
    expect(() => OccurrenceViewSchema.parse(withoutStatus)).toThrow();
  });

  it('rejects a view row with an unknown status', () => {
    expect(() => OccurrenceViewSchema.parse({ ...viewRow, status: 'unknown' })).toThrow();
  });
});
