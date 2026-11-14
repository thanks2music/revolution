/**
 * Layer 1: skipping events whose details are not announced yet (A-1-c).
 */
import { describe, expect, it } from '@jest/globals';
import {
  announcedItemCategories,
  unannouncedItemsReason,
  unannouncedScheduleReason,
} from '@/lib/utils/unannounced-event';
import type { EventPeriod } from '@/lib/services/extraction.service';

function period(start: string, end: string | null = null): EventPeriod {
  return {
    開始: { 年: '2026年', 日付: start },
    終了: { 年: end ? '2026年' : null, 日付: end, 未定: end === null },
  };
}

/** A schema-valid `event_data` (EventDataSchema) with the given occurrences */
function eventData(occurrences: Array<{ venue_label: string; starts_on: string | null }>) {
  return {
    primary_category_slug: 'collabo-cafe',
    title_slugs: ['sample-work'],
    occurrences: occurrences.map((o) => ({ venue_slug: null, ends_on: null, official_url: null, ...o })),
  };
}

const noItems = {
  メニュー詳細リスト: null,
  具体的なメニュー名リスト: null,
  グッズ名: null,
  グッズ詳細リスト: null,
  ノベルティ名: null,
};

describe('unannouncedScheduleReason', () => {
  it('writes when the start date is known', () => {
    expect(unannouncedScheduleReason({ 店舗名: 'Sample Cafe Tokyo', 開催期間: period('12月1日', '12月31日') })).toBeUndefined();
  });

  it('writes when only the end date is undecided', () => {
    expect(unannouncedScheduleReason({ 店舗名: 'Sample Cafe Tokyo', 開催期間: period('12月1日') })).toBeUndefined();
  });

  it('writes when one occurrence has a start date though the overall period does not', () => {
    const reason = unannouncedScheduleReason({
      店舗名: 'Sample Cafe Tokyo、Sample Cafe Osaka',
      開催期間: period(''),
      event_data: eventData([
        { venue_label: 'Sample Cafe Tokyo', starts_on: '2026-12-01' },
        { venue_label: 'Sample Cafe Osaka', starts_on: null },
      ]),
    });
    expect(reason).toBeUndefined();
  });

  it('skips "venue known, dates unknown" (condition 2)', () => {
    const reason = unannouncedScheduleReason({ 店舗名: 'Sample Cafe Tokyo', 開催期間: period('') });
    expect(reason).toContain('開始日を読み取れない');
    expect(reason).toContain('Sample Cafe Tokyo');
    expect(reason).toContain('画像にだけ書かれている');
  });

  it.each(['未定', '後日発表', ''])('skips the first announcement only when the venue is "%s" (condition 1)', (venue) => {
    const reason = unannouncedScheduleReason({ 店舗名: venue, 開催期間: period('') });
    expect(reason).toContain('第一報のみ');
  });

  it('does not take words such as 後日発表 as a start date', () => {
    expect(unannouncedScheduleReason({ 店舗名: 'Sample Cafe Tokyo', 開催期間: period('後日発表') })).toContain(
      '開始日を読み取れない'
    );
  });

  it.each([
    ['a weekday suffix', '12月1日(月)'],
    ['a date that does not exist', '2月30日'],
  ])('skips when the start date has %s, since the article could not show it', (_label, date) => {
    expect(unannouncedScheduleReason({ 店舗名: 'Sample Cafe Tokyo', 開催期間: period(date) })).toContain(
      '開始日を読み取れない'
    );
  });

  it('skips when the start year is missing', () => {
    const p = period('12月1日');
    expect(
      unannouncedScheduleReason({ 店舗名: 'Sample Cafe Tokyo', 開催期間: { ...p, 開始: { 年: '', 日付: '12月1日' } } })
    ).toContain('開始日を読み取れない');
  });

  it.each(['2026-13-01', '2026-12-01T00:00', '未定'])('ignores an occurrence whose start date is %s', (startsOn) => {
    const reason = unannouncedScheduleReason({
      店舗名: 'Sample Cafe Tokyo',
      開催期間: period(''),
      event_data: eventData([{ venue_label: 'Sample Cafe Tokyo', starts_on: startsOn }]),
    });
    expect(reason).toContain('開始日を読み取れない');
  });
});

describe('announcedItemCategories', () => {
  it('counts the menu from either menu list, and goods from either goods list', () => {
    expect(announcedItemCategories({ ...noItems, 具体的なメニュー名リスト: ['ラテ'] })).toEqual(['menu']);
    expect(
      announcedItemCategories({ ...noItems, グッズ詳細リスト: [{ name: 'アクリルスタンド', price: null, sales: null }] })
    ).toEqual(['goods']);
  });

  it('treats empty lists as not announced', () => {
    expect(announcedItemCategories({ ...noItems, メニュー詳細リスト: [], グッズ名: [], ノベルティ名: [] })).toEqual([]);
  });
});

describe('unannouncedItemsReason', () => {
  it.each(['collabo-cafe', 'chain-store', 'other', 'unknown-type'])(
    'writes a %s event when any one of menu, goods or novelty is announced',
    (eventType) => {
      expect(unannouncedItemsReason(eventType, { ...noItems, 具体的なメニュー名リスト: ['ラテ'] })).toBeUndefined();
      expect(unannouncedItemsReason(eventType, { ...noItems, グッズ名: ['缶バッジ'] })).toBeUndefined();
      expect(unannouncedItemsReason(eventType, { ...noItems, ノベルティ名: ['コースター'] })).toBeUndefined();
    }
  );

  it('skips a collabo cafe with none of the three (condition 3)', () => {
    const reason = unannouncedItemsReason('collabo-cafe', noItems);
    expect(reason).toContain('メニュー・グッズ・ノベルティのどれも発表されていない');
    expect(reason).toContain('発表済みの品目: なし');
  });

  it('requires goods for a pop-up store', () => {
    expect(unannouncedItemsReason('pop-up-store', { ...noItems, グッズ名: ['缶バッジ'] })).toBeUndefined();
    const reason = unannouncedItemsReason('pop-up-store', { ...noItems, ノベルティ名: ['ステッカー'] });
    expect(reason).toContain('グッズが発表されていない');
    expect(reason).toContain('発表済みの品目: ノベルティ');
  });

  it('requires novelty or goods for an exhibition', () => {
    expect(unannouncedItemsReason('exhibition', { ...noItems, ノベルティ名: ['ポストカード'] })).toBeUndefined();
    expect(unannouncedItemsReason('exhibition', { ...noItems, グッズ名: ['図録'] })).toBeUndefined();
    expect(unannouncedItemsReason('exhibition', { ...noItems, 具体的なメニュー名リスト: ['ラテ'] })).toContain(
      'ノベルティ・グッズのどれも発表されていない'
    );
  });
});
