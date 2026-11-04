/**
 * alignEventDataSlugs (Layer 1): event_data の作品の slug を辞書の slug にそろえる
 *
 * 辞書は架空の作品の fixture (実辞書は private repo の同期コピーで CI に無い)。
 */
import { describe, expect, it } from '@jest/globals';

import type { EventData } from '@revolution/schemas/mdx-frontmatter';

import { alignEventDataSlugs, type TitleDictionary } from '@/lib/utils/align-event-data-slugs';

const ENTRIES: Record<string, { slug: string; aliases: string[] }> = {
  作品A: { slug: 'work-a', aliases: ['alias-a', 'old-work-a'] },
  作品B: { slug: 'work-b', aliases: [] },
  作品W: { slug: 'work-a-x', aliases: ['work'] },
};

const dictionary: TitleDictionary = {
  slugOfTitle: (title) => ENTRIES[title]?.slug ?? null,
  canonicalOfSlug: (slug) => {
    for (const entry of Object.values(ENTRIES)) {
      if (entry.slug === slug || entry.aliases.includes(slug)) return entry.slug;
    }
    return null;
  },
  slugAliasesOf: (slug) => Object.values(ENTRIES).find((entry) => entry.slug === slug)?.aliases ?? [],
};

const eventData = (overrides: Partial<EventData>): EventData => ({
  primary_category_slug: 'collabo-cafe',
  title_slugs: [],
  supplementary_category_slugs: [],
  occurrences: [{ venue_slug: null, venue_label: '会場', starts_on: '2026-11-01', ends_on: null, official_url: null }],
  ...overrides,
});

describe('alignEventDataSlugs: 単一作品', () => {
  it('辞書に無い綴りの slug を、作品名を辞書で引いた slug に置き換え、event_slug の作品の部分も直す', () => {
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['sakuhin-romaji'], event_slug: 'sakuhin-romaji-cafe-x' }),
      works: [{ title: '作品A', is_primary: true }],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData.title_slugs).toEqual(['work-a']);
    expect(result.eventData.event_slug).toBe('work-a-cafe-x');
    expect(result.changes).toEqual([
      'title_slugs: sakuhin-romaji → work-a',
      'event_slug: sakuhin-romaji-cafe-x → work-a-cafe-x',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('slug の形の別名 (旧 slug やローマ字) は辞書の slug にする', () => {
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['alias-a'], event_slug: 'alias-a-cafe-2026' }),
      works: [{ title: '作品A', is_primary: true }],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData.title_slugs).toEqual(['work-a']);
    expect(result.eventData.event_slug).toBe('work-a-cafe-2026');
  });

  it('title_slugs が辞書どおりでも、event_slug にある別名の綴りは直す', () => {
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['work-a'], event_slug: 'old-work-a-cafe' }),
      works: [{ title: '作品A', is_primary: true }],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData.event_slug).toBe('work-a-cafe');
    expect(result.changes).toEqual(['event_slug: old-work-a-cafe → work-a-cafe']);
  });

  it('すでに辞書どおりなら何も変えない', () => {
    const input = eventData({ title_slugs: ['work-a'], event_slug: 'work-a-cafe' });
    const result = alignEventDataSlugs({ eventData: input, works: [{ title: '作品A', is_primary: true }], workSlug: 'work-a', dictionary });
    expect(result.eventData).toEqual(input);
    expect(result.changes).toEqual([]);
  });

  it('作品名が辞書に無くても、記事の work_slug が辞書の slug ならそれを使う', () => {
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['romaji'], event_slug: 'romaji-cafe' }),
      works: [{ title: '作品A 副題つき', is_primary: true }],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData.title_slugs).toEqual(['work-a']);
    expect(result.eventData.event_slug).toBe('work-a-cafe');
  });

  it('辞書に無い作品は LLM の値のまま残し、作品名を返す', () => {
    const input = eventData({ title_slugs: ['llm-slug'], event_slug: 'llm-slug-cafe' });
    const result = alignEventDataSlugs({
      eventData: input,
      works: [{ title: '辞書に無い作品', is_primary: true }],
      workSlug: 'ai-fallback-slug',
      dictionary,
    });
    expect(result.eventData).toEqual(input);
    expect(result.unknownWorks).toEqual(['辞書に無い作品']);
  });
});

describe('alignEventDataSlugs: 複数作品', () => {
  it('1 対 1 で決まる分を置き換え、主作品を先頭に移す', () => {
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['work-b', 'romaji-a'], event_slug: 'romaji-a-x-work-b-cafe' }),
      works: [
        { title: '作品A', is_primary: true },
        { title: '作品B', is_primary: false },
      ],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData.title_slugs).toEqual(['work-a', 'work-b']);
    expect(result.eventData.event_slug).toBe('work-a-x-work-b-cafe');
  });

  it('2 つ以上ずれて対応が決まらなければ置き換えず、警告を返す', () => {
    const input = eventData({ title_slugs: ['romaji-a', 'romaji-b'], event_slug: 'romaji-a-romaji-b-cafe' });
    const result = alignEventDataSlugs({
      eventData: input,
      works: [
        { title: '作品A', is_primary: true },
        { title: '作品B', is_primary: false },
      ],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData.title_slugs).toEqual(['romaji-a', 'romaji-b']);
    expect(result.eventData.event_slug).toBe('romaji-a-romaji-b-cafe');
    expect(result.warnings).toHaveLength(1);
  });
});

describe('alignEventDataSlugs: event_slug の差し替え', () => {
  it('区切り (ハイフン) 単位でだけ差し替える', () => {
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['alias-a'], event_slug: 'alias-ab-cafe-special-alias-a' }),
      works: [{ title: '作品A', is_primary: true }],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData.event_slug).toBe('alias-ab-cafe-special-work-a');
  });

  it('差し替えた後の文字列に、別の綴りをもう一度当てない', () => {
    // 作品W の別名「work」を「work-a-x」に差し替えた後、その中の「work」に再び当てない
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['work-a-x'], event_slug: 'work-cafe' }),
      works: [{ title: '作品W', is_primary: true }],
      workSlug: 'work-a-x',
      dictionary,
    });
    expect(result.eventData.event_slug).toBe('work-a-x-cafe');
  });

  it('event_slug が無ければ足さない', () => {
    const result = alignEventDataSlugs({
      eventData: eventData({ title_slugs: ['alias-a'] }),
      works: [{ title: '作品A', is_primary: true }],
      workSlug: 'work-a',
      dictionary,
    });
    expect(result.eventData).not.toHaveProperty('event_slug');
    expect(result.eventData.title_slugs).toEqual(['work-a']);
  });
});
