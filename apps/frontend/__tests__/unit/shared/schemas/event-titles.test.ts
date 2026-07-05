import { describe, expect, it } from '@jest/globals';

import { EventTitleInsertSchema } from '@revolution/schemas/event';

/**
 * Sprint B 固有シナリオ: コラボイベント表現 (M:N event_titles、複数 title_id)
 *
 * 1 event に 2+ titles を関連付ける場合 (例: 呪術廻戦 × 鬼滅の刃 のコラボカフェ)、
 * event_titles に個別レコードを挿入することで表現する。Layer 1 では Zod insert
 * 型が各レコードを個別に受理することを検証。DB 側の composite PK 重複拒否は
 * Layer 2 (`event_titles_event_id_title_id_pk`) で保証、onDelete cascade/restrict
 * も Layer 2 のみで検証 (Layer 1 対象外)。
 */
describe('EventTitleInsertSchema', () => {
  it('accepts single title association', () => {
    expect(() => EventTitleInsertSchema.parse({ eventId: 1, titleId: 100 })).not.toThrow();
  });

  it('accepts multiple title associations for the same event (2 作品コラボ)', () => {
    // 呪術廻戦 (titleId=100) × 鬼滅の刃 (titleId=200) の 2 作品コラボ
    const collab = [
      { eventId: 1, titleId: 100 },
      { eventId: 1, titleId: 200 },
    ];
    for (const row of collab) {
      expect(() => EventTitleInsertSchema.parse(row)).not.toThrow();
    }
  });

  it('accepts 3+ title associations for the same event (large collab)', () => {
    const bigCollab = [
      { eventId: 42, titleId: 1 },
      { eventId: 42, titleId: 2 },
      { eventId: 42, titleId: 3 },
      { eventId: 42, titleId: 4 },
    ];
    for (const row of bigCollab) {
      expect(() => EventTitleInsertSchema.parse(row)).not.toThrow();
    }
  });

  it('accepts multiple event associations for the same title (逆方向: 1 title × 複数 event)', () => {
    // 呪術廻戦 (titleId=100) が複数 event (event 1 / 2 / 3) に関連
    const multiEvent = [
      { eventId: 1, titleId: 100 },
      { eventId: 2, titleId: 100 },
      { eventId: 3, titleId: 100 },
    ];
    for (const row of multiEvent) {
      expect(() => EventTitleInsertSchema.parse(row)).not.toThrow();
    }
  });

  it('rejects missing event_id', () => {
    expect(() => EventTitleInsertSchema.parse({ titleId: 100 })).toThrow();
  });

  it('rejects missing title_id', () => {
    expect(() => EventTitleInsertSchema.parse({ eventId: 1 })).toThrow();
  });
});
