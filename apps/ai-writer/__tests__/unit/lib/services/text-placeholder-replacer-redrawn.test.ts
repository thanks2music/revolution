import { describe, expect, it } from '@jest/globals';

import { TextPlaceholderReplacerService } from '@/lib/services/text-placeholder-replacer.service';

/**
 * Layer 1: `描き下ろし表記` の置換 (2026-10-15)。置換する変数は明示登録なので、登録漏れで `{{描き下ろし表記}}` が
 * 本文に残らないことを CI で確かめる (リード文のテストは Templates の YAML を読むため CI では走らない)
 */
describe('TextPlaceholderReplacerService: 描き下ろし表記', () => {
  const service = new TextPlaceholderReplacerService();
  const template = '人気キャラクター達の{{#if 描き下ろし表記}}{{描き下ろし表記}}イラストを使用した{{/if}}グッズ';

  it('語があれば {{#if}} の中を出し、{{描き下ろし表記}} を置き換える', () => {
    const result = service.replaceAll(template, { 作品名: 'A', 店舗名: 'B', 描き下ろし表記: '描き起こし' });
    expect(result.content).toBe('人気キャラクター達の描き起こしイラストを使用したグッズ');
    expect(result.unreplacedPlaceholders).toEqual([]);
  });

  it('語が無ければ {{#if}} の中を出さない (イラストの種類に触れない)', () => {
    const result = service.replaceAll(template, { 作品名: 'A', 店舗名: 'B', 描き下ろし表記: null });
    expect(result.content).toBe('人気キャラクター達のグッズ');
  });
});
