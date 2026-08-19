import { describe, expect, it } from '@jest/globals';

import {
  buildMasterSeed,
  type TitleRomajiYaml,
  type VenueMasterYaml,
} from '@/lib/ingest/build-master-seed';

const emptyVenues: VenueMasterYaml = { venues: {} };
const emptyTitles: TitleRomajiYaml = { titles: {} };

describe('buildMasterSeed', () => {
  it('kind を持つ TitleEntry だけを titles の seed 対象にする', () => {
    const plan = buildMasterSeed(
      {
        titles: {
          呪術廻戦: { slug: 'jujutsu-kaisen', kind: 'manga' },
          ハイキュー: { slug: 'haikyu' }, // kind 無し → 対象外
          '真・侍伝 YAIBA': 'yaiba', // string 形式 (v1.0) → 対象外
        },
      },
      emptyVenues,
    );

    expect(plan.titles).toEqual([{ slug: 'jujutsu-kaisen', name: '呪術廻戦', kind: 'manga' }]);
    expect(plan.errors).toEqual([]);
  });

  it('name の正規化形と aliases の正規化形を title_aliases に入れる (帰結 2)', () => {
    const plan = buildMasterSeed(
      {
        titles: {
          名探偵コナン: {
            slug: 'detective-conan',
            kind: 'manga',
            aliases: ['コナン', 'meitantei-conan'],
          },
        },
      },
      emptyVenues,
    );

    expect(plan.titleAliases).toEqual([
      { alias: '名探偵コナン', titleSlug: 'detective-conan' },
      { alias: 'コナン', titleSlug: 'detective-conan' },
      { alias: 'meitantei-conan', titleSlug: 'detective-conan' },
    ]);
  });

  it('正規化で同一キーに寄る alias は 1 行に集約する (帰結 1、エラーにしない)', () => {
    const plan = buildMasterSeed(emptyTitles, {
      venues: {
        'スイーツパラダイス 池袋店': {
          slug: 'sweets-paradise-ikebukuro',
          aliases: ['スイーツパラダイス池袋店'], // 空白違いのみ → name の正規化形と同一
        },
      },
    });

    expect(plan.venueAliases).toEqual([
      { alias: 'スイーツパラダイス池袋店', venueSlug: 'sweets-paradise-ikebukuro' },
    ]);
    expect(plan.collisions).toEqual([]);
  });

  it('別エンティティ間の alias 衝突を検出する (帰結 3、seed 停止条件)', () => {
    const plan = buildMasterSeed(
      {
        titles: {
          作品A: { slug: 'work-a', kind: 'other', aliases: ['かぶるやつ'] },
          作品B: { slug: 'work-b', kind: 'other', aliases: ['かぶるやつ'] },
        },
      },
      emptyVenues,
    );

    expect(plan.collisions).toEqual([
      { table: 'title_aliases', alias: 'かぶるやつ', slugs: ['work-a', 'work-b'] },
    ]);
  });

  it('title と venue の alias は別テーブルなので同じ文字列でも衝突にしない', () => {
    const plan = buildMasterSeed(
      { titles: { ポチャッコ: { slug: 'pochacco', kind: 'other' } } },
      { venues: { ポチャッコ: { slug: 'pochacco-cafe' } } },
    );

    expect(plan.collisions).toEqual([]);
  });

  it('venues は全エントリを seed 対象にし、所在地の欠落は null で埋める', () => {
    const plan = buildMasterSeed(emptyTitles, {
      venues: {
        'Cafe Fan Base': {
          slug: 'cafe-fan-base',
          prefecture: '神奈川県',
          city: '横浜市西区',
        },
      },
    });

    expect(plan.venues).toEqual([
      {
        slug: 'cafe-fan-base',
        name: 'Cafe Fan Base',
        prefecture: '神奈川県',
        city: '横浜市西区',
        address: null,
      },
    ]);
  });

  it('kind の不正値と slug の形式違反を errors に集める (seed 停止条件)', () => {
    const plan = buildMasterSeed(
      { titles: { 作品C: { slug: 'work-c', kind: 'movie' } } }, // CHECK 外の kind
      { venues: { 会場X: { slug: 'Bad_Slug' } } },
    );

    expect(plan.errors).toHaveLength(2);
    expect(plan.errors[0]).toContain('kind "movie"');
    expect(plan.errors[1]).toContain('slug "Bad_Slug"');
    expect(plan.titles).toEqual([]);
    expect(plan.venues).toEqual([]);
  });

  it('同一 slug が複数エントリで定義されたら errors に集める', () => {
    const plan = buildMasterSeed(emptyTitles, {
      venues: {
        会場1: { slug: 'same-slug' },
        会場2: { slug: 'same-slug' },
      },
    });

    expect(plan.errors).toEqual(['venues: slug "same-slug" が複数エントリで重複']);
  });
});
