/**
 * Layer 1: まとめの表の「開催期間」と「お問い合わせ」のセル (`lib/services/summary-table.ts`)
 */
import { describe, expect, it } from '@jest/globals';
import {
  applySummaryRows,
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
  map_row_label: '地図',
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
  { venue_label: '原宿', starts_on: '2026-10-16', ends_on: '2026-12-20' },
  { venue_label: '名古屋', starts_on: '2026-10-16', ends_on: '2026-11-29' },
  { venue_label: '札幌', starts_on: '2026-10-16', ends_on: '2026-11-29' },
  { venue_label: '大阪', starts_on: '2026-10-22', ends_on: '2026-12-06' },
];

describe('periodsDiffer', () => {
  it('開始日か終了日が会場で違えば true', () => {
    expect(periodsDiffer(heroaca)).toBe(true);
    expect(
      periodsDiffer([
        { venue_label: 'A', starts_on: '2026-10-16', ends_on: '2026-12-20' },
        { venue_label: 'B', starts_on: '2026-10-22', ends_on: '2026-12-20' },
      ]),
    ).toBe(true);
  });

  it('全会場が同じ日程、または会場が 1 つなら false', () => {
    expect(
      periodsDiffer([
        { venue_label: 'A', starts_on: '2026-10-16', ends_on: '2026-12-20' },
        { venue_label: 'B', starts_on: '2026-10-16', ends_on: '2026-12-20' },
      ]),
    ).toBe(false);
    expect(periodsDiffer([{ venue_label: 'A', starts_on: '2026-10-16', ends_on: '2026-12-20' }])).toBe(false);
  });

  it('同じ会場の前期・後期は 1 つの会場の日程として扱う (会場が 1 つなら false)', () => {
    expect(
      periodsDiffer([
        { venue_label: 'A', starts_on: '2026-10-01', ends_on: '2026-10-31' },
        { venue_label: 'A', starts_on: '2026-11-05', ends_on: '2026-11-30' },
      ]),
    ).toBe(false);
  });

  it('会場名の無い会場どうしは 1 つにまとめる (日程が違っても、どの会場か分からないので注記を付けない)', () => {
    expect(
      periodsDiffer([
        { venue_label: null, starts_on: '2026-10-16', ends_on: '2026-12-20' },
        { venue_label: null, starts_on: '2026-10-22', ends_on: '2026-12-06' },
      ]),
    ).toBe(false);
  });

  it('日付の分からない会場は比べない (分からないことを「違う」とは言わない)', () => {
    expect(
      periodsDiffer([
        { venue_label: 'A', starts_on: '2026-10-16', ends_on: '2026-12-20' },
        { venue_label: 'B', starts_on: null, ends_on: null },
      ]),
    ).toBe(false);
    expect(
      periodsDiffer([
        { venue_label: 'A', starts_on: '2026-10-16', ends_on: null },
        { venue_label: 'B', starts_on: '2026-10-16', ends_on: '2026-12-20' },
      ]),
    ).toBe(false);
  });
});

describe('renderSummaryPeriod', () => {
  it('会場ごとに日程が違えば、全体の期間に「（会場により異なる）」を付ける (ヒロアカ)', () => {
    expect(renderSummaryPeriod({ start: '2026-10-16', end: '2026-12-20' }, heroaca, pointsFormat, config)).toBe(
      '2026年10月16日〜12月20日（会場により異なる）',
    );
  });

  it('全会場が同じ日程なら付けない', () => {
    const same = [{ venue_label: 'A', starts_on: '2026-08-20', ends_on: '2026-09-20' }];
    expect(renderSummaryPeriod({ start: '2026-08-20', end: '2026-09-20' }, same, pointsFormat, config)).toBe('2026年8月20日〜9月20日');
  });

  it('年をまたぐなら終了日にも年を書く', () => {
    const across = [{ venue_label: 'A', starts_on: '2026-12-10', ends_on: '2027-01-31' }];
    expect(renderSummaryPeriod({ start: '2026-12-10', end: '2027-01-31' }, across, pointsFormat, config)).toBe(
      '2026年12月10日〜2027年1月31日',
    );
  });

  it('終了日が分からなければ「より」で書く (この記事のポイントの「〜」とは別の文言)', () => {
    const open = [{ venue_label: 'A', starts_on: '2026-10-16', ends_on: null }];
    expect(renderSummaryPeriod({ start: '2026-10-16' }, open, pointsFormat, config)).toBe('2026年10月16日より');
  });

  it('開始日が無ければ null (LLM の行を残す)', () => {
    expect(renderSummaryPeriod({}, [{ venue_label: 'A', starts_on: null, ends_on: null }], pointsFormat, config)).toBeNull();
  });

  it('event_data が無ければ、抽出した開催期間を注記なしで書く', () => {
    expect(renderSummaryPeriod({ start: '2026-10-16', end: '2026-12-20' }, [], pointsFormat, config)).toBe('2026年10月16日〜12月20日');
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

  it('店舗名の { } < > と | は MDX と表を壊さないようにする (前後の空白も落とす)', () => {
    expect(renderSummaryContact('', [' カフェ{A}<B>|C '], config)).toBe(
      'カフェ&#123;A&#125;&#60;B&#62;｜Cにお問い合わせください',
    );
  });
});

describe('applySummaryRows', () => {
  const input = {
    period: { start: '2026-10-16', end: '2026-12-20' },
    occurrences: heroaca,
    representative: '',
    venues: ['原宿', '名古屋', '札幌', '大阪'],
    pointsFormat,
    config: { ...config, venue_row_label: '開催場所' },
  };
  const table = (rows: string[]) => ['## まとめ', '', '| 項目 | 内容 |', '|------|------|', ...rows].join('\n');

  it('LLM が書いた開催期間を置き換え、書かなかったお問い合わせを開催期間の後ろに足す (ヒロアカ)', () => {
    const content = table(['| 開催場所 | ・原宿<br />・名古屋 |', '| 開催期間 | 2026年10月16日〜12月20日 |']);
    expect(applySummaryRows(content, input)).toEqual({
      content: table([
        '| 開催場所 | ・原宿<br />・名古屋 |',
        '| 開催期間 | 2026年10月16日〜12月20日（会場により異なる） |',
        '| お問い合わせ | 各開催店舗にお問い合わせください |',
      ]),
      missing: [],
    });
  });

  it('LLM のお問い合わせ (X のリンク) を置き換える', () => {
    const content = table(['| 開催期間 | x |', '| お問い合わせ | [公式X(旧Twitter)](https://twitter.com/example) |']);
    expect(applySummaryRows(content, input).content).toContain('| お問い合わせ | 各開催店舗にお問い合わせください |');
    expect(applySummaryRows(content, input).content).not.toContain('twitter.com');
  });

  it('開催期間の行も無ければ、開催場所の後ろに足す', () => {
    const content = table(['| 開催場所 | A |']);
    expect(applySummaryRows(content, input).content).toBe(
      table([
        '| 開催場所 | A |',
        '| 開催期間 | 2026年10月16日〜12月20日（会場により異なる） |',
        '| お問い合わせ | 各開催店舗にお問い合わせください |',
      ]),
    );
  });

  it('前に来る行が 1 つも無ければ missing に返す', () => {
    const content = table(['| 公式サイト | x |']);
    expect(applySummaryRows(content, input)).toEqual({ content, missing: ['開催期間', 'お問い合わせ'] });
  });
});
