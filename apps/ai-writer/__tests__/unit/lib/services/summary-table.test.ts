/**
 * Layer 1: まとめの表の「開催期間」と「お問い合わせ」のセル (`lib/services/summary-table.ts`)
 */
import { describe, expect, it } from '@jest/globals';
import {
  periodsDiffer,
  renderSummaryContact,
  renderSummaryPeriod,
  type SummaryRowsConfig,
} from '../../../../lib/services/summary-table';
import type { PointsFormat } from '../../../../lib/services/article-points';

const config: SummaryRowsConfig = {
  period_row_label: '開催期間',
  period_open: '{{start}}より',
  period_varies_note: '（会場により異なる）',
  contact_row_label: 'お問い合わせ',
  contact_single: '{{代表店舗名}}にお問い合わせください',
  contact_multi: '各開催店舗にお問い合わせください',
};

// 期間の書式は 01b-points.yaml の rendered と同じ形 (ほかのキーはこのテストでは使わない)
const pointsFormat = {
  date: '{{year}}年{{month}}月{{day}}日',
  date_same_year: '{{month}}月{{day}}日',
  period: '{{start}}〜{{end}}',
  period_open: '{{start}}〜',
} as unknown as PointsFormat;

/** ヒロアカ (2026-10-17 の dry-run の event_data) */
const heroaca = [
  { starts_on: '2026-10-16', ends_on: '2026-12-20' },
  { starts_on: '2026-10-16', ends_on: '2026-11-29' },
  { starts_on: '2026-10-16', ends_on: '2026-11-29' },
  { starts_on: '2026-10-22', ends_on: '2026-12-06' },
];

describe('periodsDiffer', () => {
  it('開始日か終了日が会場で違えば true', () => {
    expect(periodsDiffer(heroaca)).toBe(true);
    expect(periodsDiffer([{ starts_on: '2026-10-16', ends_on: '2026-12-20' }, { starts_on: '2026-10-22', ends_on: '2026-12-20' }])).toBe(true);
    expect(periodsDiffer([{ starts_on: '2026-10-16', ends_on: '2026-12-20' }, { starts_on: '2026-10-16', ends_on: '2026-11-29' }])).toBe(true);
  });

  it('全会場が同じ日程、または会場が 1 つなら false', () => {
    expect(periodsDiffer([{ starts_on: '2026-10-16', ends_on: '2026-12-20' }, { starts_on: '2026-10-16', ends_on: '2026-12-20' }])).toBe(false);
    expect(periodsDiffer([{ starts_on: '2026-10-16', ends_on: '2026-12-20' }])).toBe(false);
  });

  it('終了日の分からない会場があれば、分かる会場とは違う日程とみなす', () => {
    expect(periodsDiffer([{ starts_on: '2026-10-16', ends_on: null }, { starts_on: '2026-10-16', ends_on: '2026-12-20' }])).toBe(true);
  });
});

describe('renderSummaryPeriod', () => {
  it('会場ごとに日程が違えば、全体の期間に「（会場により異なる）」を付ける (ヒロアカ)', () => {
    expect(renderSummaryPeriod({ start: '2026-10-16', end: '2026-12-20' }, heroaca, pointsFormat, config)).toBe(
      '2026年10月16日〜12月20日（会場により異なる）',
    );
  });

  it('全会場が同じ日程なら付けない', () => {
    const same = [{ starts_on: '2026-08-20', ends_on: '2026-09-20' }];
    expect(renderSummaryPeriod({ start: '2026-08-20', end: '2026-09-20' }, same, pointsFormat, config)).toBe('2026年8月20日〜9月20日');
  });

  it('年をまたぐなら終了日にも年を書く', () => {
    const across = [{ starts_on: '2026-12-10', ends_on: '2027-01-31' }];
    expect(renderSummaryPeriod({ start: '2026-12-10', end: '2027-01-31' }, across, pointsFormat, config)).toBe(
      '2026年12月10日〜2027年1月31日',
    );
  });

  it('終了日が分からなければ「より」で書く (この記事のポイントの「〜」とは別の文言)', () => {
    const open = [{ starts_on: '2026-10-16', ends_on: null }];
    expect(renderSummaryPeriod({ start: '2026-10-16' }, open, pointsFormat, config)).toBe('2026年10月16日より');
  });

  it('開始日が無ければ null (LLM の行を残す)', () => {
    expect(renderSummaryPeriod({}, [{ starts_on: null, ends_on: null }], pointsFormat, config)).toBeNull();
  });
});

describe('renderSummaryContact', () => {
  it('代表店舗名があればその店舗 (会場が複数でも同じ店舗なら)', () => {
    expect(renderSummaryContact('BOX cafe&space', ['BOX cafe&space 渋谷店', 'BOX cafe&space 大阪店'], config)).toBe(
      'BOX cafe&spaceにお問い合わせください',
    );
  });

  it('代表店舗名が無く、会場が 2 つ以上なら「各開催店舗に」(ヒロアカ)', () => {
    expect(
      renderSummaryContact('', ['BOX cafe&space キュープラザ原宿店', 'コーチャンフォー新川通り店 カフェ インターリュード'], config),
    ).toBe('各開催店舗にお問い合わせください');
  });

  it('代表店舗名が無く会場が 1 つなら、その会場', () => {
    expect(renderSummaryContact(' ', ['OH MY CAFE 渋谷店'], config)).toBe('OH MY CAFE 渋谷店にお問い合わせください');
  });

  it('会場のデータが無ければ null (LLM の行を残す)', () => {
    expect(renderSummaryContact('', [], config)).toBeNull();
  });

  it('店舗名の { と | は MDX と表を壊さないようにする', () => {
    const cell = renderSummaryContact('カフェ{A}|B', [], config) ?? '';
    expect(cell).not.toContain('|');
    expect(cell).not.toMatch(/(^|[^\\])\{A\}/);
  });
});
