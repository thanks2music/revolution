import { describe, expect, it } from '@jest/globals';

import {
  planIngest,
  type ArticleEventData,
  type MasterSnapshot,
} from '@/lib/ingest/plan-ingest';

/**
 * ゲート G1〜G8 (event-review-data-model.md §8.2 の品質ゲート表) と
 * 冪等の同定規則を 1:1 で固定する。fixture の値は実データ (記事 9 本) 由来。
 */

function makeSnapshot(overrides: Partial<MasterSnapshot> = {}): MasterSnapshot {
  return {
    categoryIdBySlug: new Map([['collabo-cafe', 1]]),
    titleIdBySlug: new Map([
      ['blue-lock', 10],
      ['detective-conan', 11],
    ]),
    titleIdByAlias: new Map([['meitantei-conan', 11]]),
    venueIdBySlug: new Map([['box-cafe-and-space-gems-shibuya', 100]]),
    venueByAlias: new Map([
      [
        'boxcafeandspacegems渋谷店',
        { id: 100, slug: 'box-cafe-and-space-gems-shibuya' },
      ],
    ]),
    existingOccurrences: new Map(),
    ...overrides,
  };
}

function makeArticle(overrides: Partial<ArticleEventData['eventData']> = {}): ArticleEventData {
  return {
    articleSlug: '01m02zah3mp8jwf7',
    eventData: {
      primary_category_slug: 'collabo-cafe',
      title_slugs: ['blue-lock'],
      event_name: 'ブルーロックカフェ -青い監獄-',
      event_slug: 'blue-lock-cafe-aoi-kangoku',
      occurrences: [
        {
          venue_slug: null,
          venue_label: 'BOX cafe&space GEMS渋谷店',
          starts_on: '2026-08-20',
          ends_on: '2026-09-20',
          official_url: 'https://bluelockcafe2026.ltr-online.com',
        },
      ],
      ...overrides,
    },
  };
}

describe('planIngest', () => {
  it('G5: 全 title + venue 解決 → verified=true の insert 計画になる', () => {
    const plan = planIngest([makeArticle()], makeSnapshot());

    expect(plan.queue).toEqual([]);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      slug: 'blue-lock-cafe-aoi-kangoku',
      name: 'ブルーロックカフェ -青い監獄-',
      primaryCategoryId: 1,
      officialUrl: 'https://bluelockcafe2026.ltr-online.com',
    });
    expect(plan.eventTitles).toEqual([
      { eventSlug: 'blue-lock-cafe-aoi-kangoku', titleId: 10 },
    ]);
    expect(plan.occurrences).toEqual([
      {
        eventSlug: 'blue-lock-cafe-aoi-kangoku',
        slug: 'box-cafe-and-space-gems-shibuya',
        venueId: 100,
        venueLabel: 'BOX cafe&space GEMS渋谷店',
        startsOn: '2026-08-20',
        endsOn: '2026-09-20',
        verified: true,
        action: 'insert',
      },
    ]);
  });

  it('G1: event_slug / event_name の欠落は記事ごと保留する', () => {
    const plan = planIngest([makeArticle({ event_slug: undefined })], makeSnapshot());

    expect(plan.events).toEqual([]);
    expect(plan.occurrences).toEqual([]);
    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'missing_event_identity' }),
    ]);
    expect(plan.stats.articlesSkipped).toBe(1);
  });

  it('G1t: title_slugs が空配列の記事は保留する (verified=true の素通り防止)', () => {
    const plan = planIngest([makeArticle({ title_slugs: [] })], makeSnapshot());

    expect(plan.events).toEqual([]);
    expect(plan.occurrences).toEqual([]);
    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'missing_title_slugs', detail: 'title_slugs=[]' }),
    ]);
    expect(plan.stats.articlesSkipped).toBe(1);
  });

  it('G1c: 未知の primary_category は記事ごと保留する (events.primary_category_id が NOT NULL)', () => {
    const plan = planIngest(
      [makeArticle({ primary_category_slug: 'unknown-category' })],
      makeSnapshot(),
    );

    expect(plan.events).toEqual([]);
    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'unknown_primary_category', detail: 'unknown-category' }),
    ]);
  });

  it('G2: venue_label の決定論ガード 3 種はその occurrence だけスキップする', () => {
    const plan = planIngest(
      [
        makeArticle({
          event_name: '企画名そのもの',
          occurrences: [
            { venue_slug: null, venue_label: null, starts_on: '2026-08-20', ends_on: null, official_url: null },
            { venue_slug: null, venue_label: '企画名そのもの', starts_on: '2026-08-20', ends_on: null, official_url: null },
            { venue_slug: null, venue_label: '会場A、会場B', starts_on: '2026-08-20', ends_on: null, official_url: null },
            { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: '2026-08-20', ends_on: null, official_url: null },
          ],
        }),
      ],
      makeSnapshot(),
    );

    expect(plan.queue.map((q) => q.reason)).toEqual([
      'venue_label_missing',
      'venue_label_equals_event_name',
      'venue_label_concatenated',
    ]);
    expect(plan.occurrences).toHaveLength(1); // ガードを通った 1 件は作られる
    expect(plan.events).toHaveLength(1); // event 自体は作られる
  });

  it('G3: 新規 title は event / occurrence を作るが verified=false + キュー', () => {
    const plan = planIngest(
      [makeArticle({ title_slugs: ['unknown-title'] })],
      makeSnapshot(),
    );

    expect(plan.events).toHaveLength(1);
    expect(plan.eventTitles).toEqual([]);
    expect(plan.occurrences[0].verified).toBe(false);
    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'unknown_title', detail: 'unknown-title' }),
    ]);
  });

  it('G3: title は slug 直接一致 → alias 正規化一致の順で解決する (AI ゆれの吸収)', () => {
    const plan = planIngest(
      [makeArticle({ title_slugs: ['meitantei-conan'] })],
      makeSnapshot(),
    );

    // alias 経由で canonical (detective-conan, id=11) に解決される
    expect(plan.eventTitles).toEqual([
      { eventSlug: 'blue-lock-cafe-aoi-kangoku', titleId: 11 },
    ]);
    expect(plan.occurrences[0].verified).toBe(true);
    expect(plan.queue).toEqual([]);
  });

  it('G4: venue 解決不能なら occurrence を作らない (同一 event の他会場は続行)', () => {
    const plan = planIngest(
      [
        makeArticle({
          occurrences: [
            { venue_slug: null, venue_label: 'OH MY CAFE', starts_on: '2026-07-03', ends_on: null, official_url: null },
            { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: '2026-08-20', ends_on: null, official_url: null },
          ],
        }),
      ],
      makeSnapshot(),
    );

    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'unknown_venue', detail: 'OH MY CAFE' }),
    ]);
    expect(plan.occurrences).toHaveLength(1);
    expect(plan.stats.occurrencesQueued).toBe(1);
    expect(plan.stats.occurrencesPlanned).toBe(1);
  });

  it('G6: starts_on=null は正常系として insert する (unscheduled)', () => {
    const plan = planIngest(
      [
        makeArticle({
          occurrences: [
            { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: null, ends_on: null, official_url: null },
          ],
        }),
      ],
      makeSnapshot(),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({ startsOn: null, action: 'insert', verified: true }),
    ]);
    expect(plan.queue).toEqual([]);
  });

  it('冪等: 既存行と starts_on が一致すれば update になる (再取り込みで重複しない)', () => {
    const plan = planIngest(
      [makeArticle()],
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [{ slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2026-08-20', endsOn: '2026-09-20', verified: false }],
          ],
        ]),
      }),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({ slug: 'box-cafe-and-space-gems-shibuya', action: 'update' }),
    ]);
  });

  it('冪等: 既存 starts_on=null → incoming 非 null は update (第一報 → 続報の日付確定)', () => {
    const plan = planIngest(
      [makeArticle()],
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [{ slug: 'box-cafe-and-space-gems-shibuya', startsOn: null, endsOn: null, verified: false }],
          ],
        ]),
      }),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({ action: 'update', startsOn: '2026-08-20', endsOn: '2026-09-20' }),
    ]);
  });

  it('冪等: incoming null は既存の確定日付を消さない', () => {
    const plan = planIngest(
      [
        makeArticle({
          occurrences: [
            { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: null, ends_on: null, official_url: null },
          ],
        }),
      ],
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [{ slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2026-08-20', endsOn: '2026-09-20', verified: false }],
          ],
        ]),
      }),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({ action: 'update', startsOn: '2026-08-20', endsOn: '2026-09-20' }),
    ]);
  });

  it('G7: 既存行と期間違い (再演) は -YYYYMM 接尾辞で別行 insert する', () => {
    const plan = planIngest(
      [makeArticle()],
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [{ slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2025-04-01', endsOn: '2025-05-01', verified: false }],
          ],
        ]),
      }),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({
        slug: 'box-cafe-and-space-gems-shibuya-202608',
        action: 'insert',
      }),
    ]);
  });

  it('G8 相当: 衝突候補でも incoming starts_on=null は既存行への update に吸収する (別行を作らない)', () => {
    const plan = planIngest(
      [
        makeArticle({
          occurrences: [
            { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: null, ends_on: null, official_url: null },
          ],
        }),
      ],
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [{ slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2025-04-01', endsOn: null, verified: false }],
          ],
        ]),
      }),
    );

    // starts_on = null の入力は「期間違いの再演」を立証できないため、既存行への
    // update (既存日付は保持) に倒す。日付なしの重複行は決して作られない —
    // これが doc の G8 の意図。再演は日付が判明した続報で G7 が別行化する。
    expect(plan.occurrences).toEqual([
      expect.objectContaining({ action: 'update', startsOn: '2025-04-01' }),
    ]);
  });

  it('同一記事内の同一会場・別期間 (第1弾/第2弾) も -YYYYMM で区別する', () => {
    const plan = planIngest(
      [
        makeArticle({
          occurrences: [
            { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: '2026-08-20', ends_on: '2026-09-20', official_url: null },
            { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: '2026-10-01', ends_on: '2026-11-01', official_url: null },
          ],
        }),
      ],
      makeSnapshot(),
    );

    expect(plan.occurrences.map((o) => o.slug)).toEqual([
      'box-cafe-and-space-gems-shibuya',
      'box-cafe-and-space-gems-shibuya-202610',
    ]);
  });

  it('同一 event_slug の複数記事 (第一報 + 続報) は 1 event にマージする', () => {
    const first = makeArticle();
    const second: ArticleEventData = {
      articleSlug: '01m9999999999999',
      eventData: {
        ...first.eventData,
        occurrences: [
          { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: '2026-08-20', ends_on: '2026-09-20', official_url: null },
        ],
      },
    };
    const plan = planIngest([first, second], makeSnapshot());

    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].articleSlugs).toEqual(['01m02zah3mp8jwf7', '01m9999999999999']);
    // 2 記事目の同一 occurrence は計画済み行へマージされ、重複エントリを作らない
    // (insert → update の二重書き込みで後勝ち上書きされるのを防ぐ)
    expect(plan.occurrences.map((o) => o.action)).toEqual(['insert']);
    expect(plan.stats.occurrencesPlanned).toBe(1);
  });

  it('同一行を指す複数記事の verified は単調増加でマージする (巻き戻り防止)', () => {
    const resolved = makeArticle(); // title 全解決 → verified=true
    const unresolvedOlder: ArticleEventData = {
      articleSlug: '01m9999999999999',
      eventData: {
        ...resolved.eventData,
        title_slugs: ['unknown-title'], // 未解決 → 単体なら verified=false
      },
    };

    // 新しい記事 (解決済み) が先、古い記事 (未解決) が後 — index の日付降順を模す
    const plan = planIngest([resolved, unresolvedOlder], makeSnapshot());
    expect(plan.occurrences).toEqual([expect.objectContaining({ verified: true })]);

    // 逆順 (未解決が先) でも、後の記事で全解決すれば true へ昇格する
    const planReversed = planIngest([unresolvedOlder, resolved], makeSnapshot());
    expect(planReversed.occurrences).toEqual([expect.objectContaining({ verified: true })]);
  });

  it('同一 event_slug で primary_category が食い違ったら先勝ち + キューで可視化する', () => {
    const first = makeArticle();
    const second: ArticleEventData = {
      articleSlug: '01m9999999999999',
      eventData: {
        ...first.eventData,
        primary_category_slug: 'pop-up-store',
        occurrences: [],
      },
    };
    const plan = planIngest(
      [first, second],
      makeSnapshot({
        categoryIdBySlug: new Map([
          ['collabo-cafe', 1],
          ['pop-up-store', 2],
        ]),
      }),
    );

    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].primaryCategoryId).toBe(1); // 先勝ち
    expect(plan.queue).toEqual([
      expect.objectContaining({
        reason: 'primary_category_mismatch',
        articleSlug: '01m9999999999999',
      }),
    ]);
  });

  it('同一 event_slug で event_name が食い違ったら先勝ち + キューで可視化する', () => {
    const first = makeArticle();
    const second: ArticleEventData = {
      articleSlug: '01m9999999999999',
      eventData: { ...first.eventData, event_name: '第2弾の別名', occurrences: [] },
    };
    const plan = planIngest([first, second], makeSnapshot());

    expect(plan.events[0].name).toBe('ブルーロックカフェ -青い監獄-'); // 先勝ち
    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'event_name_mismatch', articleSlug: '01m9999999999999' }),
    ]);
  });

  it('supplementary category は既知なら event_categories、未知なら非ブロッキングのキュー', () => {
    const plan = planIngest(
      [makeArticle({ supplementary_category_slugs: ['pop-up-store', 'unknown-supp'] })],
      makeSnapshot({
        categoryIdBySlug: new Map([
          ['collabo-cafe', 1],
          ['pop-up-store', 2],
        ]),
      }),
    );

    expect(plan.eventCategories).toEqual([
      { eventSlug: 'blue-lock-cafe-aoi-kangoku', categoryId: 2 },
    ]);
    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'unknown_supplementary_category', detail: 'unknown-supp' }),
    ]);
    // 非ブロッキング: occurrence は作られる
    expect(plan.occurrences).toHaveLength(1);
  });

  it('G7 の接尾辞まで衝突したら slug_conflict_unresolvable でキューへ (3 段目の再演)', () => {
    const plan = planIngest(
      [makeArticle()], // starts_on: 2026-08-20 → 接尾辞は -202608
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [
              { slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2025-04-01', endsOn: null, verified: false },
              // 接尾辞行が別月の日付を持つ稀なケース (過去の手動整理の名残等) のみ
              // unresolvable になる。同月なら訂正として update に倒れる (下のテスト)
              { slug: 'box-cafe-and-space-gems-shibuya-202608', startsOn: '2026-07-01', endsOn: null, verified: false },
            ],
          ],
        ]),
      }),
    );

    expect(plan.occurrences).toEqual([]);
    expect(plan.queue).toEqual([
      expect.objectContaining({
        reason: 'slug_conflict_unresolvable',
        detail: 'box-cafe-and-space-gems-shibuya-202608',
      }),
    ]);
  });

  it('既存 DB 行の verified=true は、記事再編集で title が未解決になっても巻き戻さない', () => {
    // 例: 公開済み (or BOSS 人手承認済み) の行に対し、記事へ新規コラボ title が
    // 追記されたがまだ titles/title_aliases に無い → allTitlesResolved=false
    const plan = planIngest(
      [makeArticle({ title_slugs: ['blue-lock', 'unknown-new-collab'] })],
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [{ slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2026-08-20', endsOn: '2026-09-20', verified: true }],
          ],
        ]),
      }),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({ action: 'update', verified: true }), // 単調増加
    ]);
    // 新規 title 自体はキューに上がる (承認後の再取り込みで event_titles が張られる)
    expect(plan.queue).toEqual([
      expect.objectContaining({ reason: 'unknown_title', detail: 'unknown-new-collab' }),
    ]);
  });

  it('同一年月内の日付不一致は再演ではなく訂正として update する (重複行を作らない)', () => {
    // 既存 8/1 開始 → 記事が 8/20 開始へ訂正。接尾辞は月単位 (-YYYYMM) のため
    // 同月の「再演」と「訂正」は区別できず、別行にすると訂正のたびに重複が増える
    const plan = planIngest(
      [makeArticle()], // starts_on: 2026-08-20
      makeSnapshot({
        existingOccurrences: new Map([
          [
            'blue-lock-cafe-aoi-kangoku',
            [{ slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2026-08-01', endsOn: '2026-09-01', verified: false }],
          ],
        ]),
      }),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({
        slug: 'box-cafe-and-space-gems-shibuya', // 接尾辞なし = 同一行への update
        action: 'update',
        startsOn: '2026-08-20', // 訂正後の日付が正
        endsOn: '2026-09-20',
      }),
    ]);
  });

  it('3 記事が同一行を指しても、マージ後の日付に対して再演判定される (照合インデックスの同期)', () => {
    // A (最新, 日付未発表) → insert / B (続報, 日付確定) → A へマージ /
    // C (月をまたぐ真の再演) → マージ後の 9/15 と比較され G7 で別行になる。
    // 同期しないと C は A の古い null と比較され「続報 update」に誤判定 →
    // C の日付が黙って消えていた (レビュー 7 巡目指摘)
    const base = makeArticle().eventData;
    const makeOne = (articleSlug: string, startsOn: string | null): ArticleEventData => ({
      articleSlug,
      eventData: {
        ...base,
        occurrences: [
          { venue_slug: null, venue_label: 'BOX cafe&space GEMS渋谷店', starts_on: startsOn, ends_on: null, official_url: null },
        ],
      },
    });

    const plan = planIngest(
      [makeOne('article-a', null), makeOne('article-b', '2026-09-15'), makeOne('article-c', '2026-10-20')],
      makeSnapshot(),
    );

    expect(plan.occurrences).toEqual([
      expect.objectContaining({
        slug: 'box-cafe-and-space-gems-shibuya',
        startsOn: '2026-09-15', // A に B の続報がマージされた状態
        action: 'insert',
      }),
      expect.objectContaining({
        slug: 'box-cafe-and-space-gems-shibuya-202610', // C は再演として別行
        startsOn: '2026-10-20',
        action: 'insert',
      }),
    ]);
  });
});
