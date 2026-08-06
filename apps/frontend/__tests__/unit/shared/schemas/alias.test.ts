import { describe, expect, it } from '@jest/globals';

import { TitleAliasInsertSchema, VenueAliasInsertSchema } from '@revolution/schemas/alias';

describe('TitleAliasInsertSchema', () => {
  it.each([
    ['hiragana', 'じゅじゅつかいせん'],
    ['kanji', '呪術廻戦'],
    ['romaji', 'jujutsukaisen'],
    ['uppercase english', 'JUJUTSU KAISEN'],
    ['mixed with digits', 'Fate/stay night'],
  ])('accepts a %s alias', (_label, alias) => {
    expect(() => TitleAliasInsertSchema.parse({ alias, titleId: 1 })).not.toThrow();
  });

  it('rejects a blank alias', () => {
    expect(() => TitleAliasInsertSchema.parse({ alias: '   ', titleId: 1 })).toThrow();
  });

  it('rejects an alias of only full-width spaces', () => {
    expect(() => TitleAliasInsertSchema.parse({ alias: '　　', titleId: 1 })).toThrow();
  });

  it('rejects an empty alias', () => {
    expect(() => TitleAliasInsertSchema.parse({ alias: '', titleId: 1 })).toThrow();
  });

  it('rejects a missing title_id', () => {
    expect(() => TitleAliasInsertSchema.parse({ alias: '呪術廻戦' })).toThrow();
  });
});

describe('VenueAliasInsertSchema', () => {
  it.each([
    ['japanese venue name', '表参道ヒルズ'],
    ['floor notation', '本館地下 3 階'],
    ['mixed script', '渋谷PARCO B1F'],
  ])('accepts a %s alias', (_label, alias) => {
    expect(() => VenueAliasInsertSchema.parse({ alias, venueId: 1 })).not.toThrow();
  });

  it('rejects a blank alias', () => {
    expect(() => VenueAliasInsertSchema.parse({ alias: '   ', venueId: 1 })).toThrow();
  });

  it('rejects an alias of only full-width spaces', () => {
    expect(() => VenueAliasInsertSchema.parse({ alias: '　　', venueId: 1 })).toThrow();
  });

  it('rejects a missing venue_id', () => {
    expect(() => VenueAliasInsertSchema.parse({ alias: '表参道ヒルズ' })).toThrow();
  });
});

// slug 系テーブル (categories / titles / venues / events / occurrences) と違い、
// alias には ASCII slug の正規表現を掛けない。別名は実世界の表記そのもので、
// slug 制約を課すと名寄せの対象を取りこぼすため (alias.ts の docstring 参照)。
describe('alias schemas do not impose slug formatting', () => {
  it.each([
    ['uppercase', 'JUJUTSU KAISEN'],
    ['spaces', '表参道 ヒルズ'],
    ['slashes', 'Fate/stay night'],
    ['punctuation', 'Re:ゼロから始める異世界生活'],
  ])('accepts an alias containing %s', (_label, alias) => {
    expect(() => TitleAliasInsertSchema.parse({ alias, titleId: 1 })).not.toThrow();
    expect(() => VenueAliasInsertSchema.parse({ alias, venueId: 1 })).not.toThrow();
  });
});
