import { describe, expect, it } from '@jest/globals';

import {
  compareWithSource,
  formatOccurrenceCountBreakdown,
  formatSourceComparisonLines,
  warnOnceForSourceIssues,
  extractPeriodText,
  extractSourceTruth,
  parsePeriodText,
  unescapeEmbeddedMarkup,
} from '@/lib/utils/source-truth-extractor';

/**
 * すべて実データの構造をそのまま写した inline fixture。
 *
 * `debug-logs/` の保存 HTML を読みに行くと、gitignored なローカル成果物に依存して
 * CI で落ちる (`templates/` で実際にやった失敗と同じ形)。
 */
const LTR_TOP_PAGE = `
<!DOCTYPE html><html><head><title>『薬屋のひとりごと』原作小説カフェ</title></head>
<body>
  <div class="info-container">
    <div class="place">
      <h2>TOKYO</h2>
      <p class="place_text_01">BOX cafe&amp;space マツモトキヨシ池袋Part2店</p>
      <p class="place_text_02"><span>【開催期間】</span> 2026年5月14日(木)〜2026年7月5日(日)</p>
    </div>
    <div class="place">
      <h2>OSAKA</h2>
      <p class="place_text_01">BOX cafe&amp;space ＫＩＴＴＥ OSAKA 2号店</p>
      <p class="place_text_02"><span>【開催期間】</span> 2026年5月28日(木)〜2026年6月28日(日)</p>
    </div>
  </div>
</body></html>`;

/**
 * miku / nissy と同じ形。マークアップが `\uXXXX` + `\&quot;` + `\/` で
 * エスケープされた文字列として本文中に置かれている (`<script>` の中ではない)。
 * 生の検索でも cheerio でも `.place` は 0 件に見える。
 *
 * ⚠️ 実データは `&amp;amp;` の**二重エスケープ**まで含む。cheerio が 1 段、
 * 本モジュールの実体参照デコードがもう 1 段を解いて `&` に戻る。
 */
const ESCAPED_PAYLOAD_PAGE = `
<!DOCTYPE html><html><body>
<div class=\\&quot;info-container\\&quot;>\\n            <div class=\\&quot;place\\&quot;>\\n                <h2>TOKYO<\\/h2>\\n                <p class=\\&quot;place_text_01\\&quot;>BOX cafe&amp;amp;space \\u30b0\\u30e9\\u30f3\\u30c9\\u30b9\\u30b1\\u30fc\\u30d7\\u6c60\\u888b\\u5e97<\\/p>\\n                <p class=\\&quot;place_text_02\\&quot;><span>\\u3010\\u958b\\u50ac\\u671f\\u9593\\u3011<\\/span> 2026\\u5e748\\u67087\\u65e5(\\u91d1)\\u301c2026\\u5e749\\u670827\\u65e5(\\u65e5)<\\/p>\\n            <\\/div>\\n        <\\/div>
</body></html>`;

/** 会場一覧を含まない下層ページ (TOKYO 専用ページ)。 */
const SUBPAGE_WITHOUT_PLACES = `
<!DOCTYPE html><html><head><title>TOKYO INFORMATION</title></head>
<body><div class="page-content-wrapper"><h1>TOKYO 開催情報</h1><p>開催期間 2026年5月14日〜7月5日</p></div></body></html>`;

/**
 * hivelocity 系 (`conan-cafe.jp` / `jujutsukaisen-cafe.jp`) の構造をそのまま写したもの。
 *
 * ⚠️ **3 番目のブロックは期間が `h4` ではなく `<p><font>` に入っている。** これは
 * `conan-cafe.jp` の HARAJUKU / OSAKA（KITTE）で実在する装飾差で、期間をタグ固定で
 * 読むと 10 件中 2 件が黙って期間なしになる (実測 2026-08-13)。
 *
 * ⚠️ **冒頭のリード文にイベント全体の期間 (`〜順次開催!!`) がある。** これも実在の形で、
 * 会場ごとの期間として各会場へ配ってはいけない。ブロック内テキストだけを見ることで
 * 混入しないことを固定する。
 */
const HIVELOCITY_TOP_PAGE = `
<!DOCTYPE html><html><head><title>名探偵コナンカフェ</title></head>
<body>
  <div class="p-top-lead">
    <p>6都市で「名探偵コナンカフェ」期間限定オープン！！ 2026年4月10日（金）～順次開催!!</p>
  </div>
  <div class="p-top-information">
    <div class="p-top-information__bloc">
      <h2>SHIBUYA</h2>
      <h3>BOX cafe&amp;space GEMS渋谷店</h3>
      <h4>2026年4月10日 (金) 〜 2026年6月28日 (日)</h4>
    </div>
    <div class="p-top-information__bloc">
      <h2>KANAGAWA</h2>
      <h3>Cafe Fan Base</h3>
      <h4>2026年5月14日 (木) 〜 2026年7月26日 (日)</h4>
    </div>
    <div class="p-top-information__bloc">
      <h2>HARAJUKU</h2>
      <h3>BOX cafe&amp;space キュープラザ原宿店</h3>
      <p style="color:#dd3333"><font size=5>2026年6月11日（木）〜2026年7月19日（日）</font></p>
    </div>
  </div>
</body></html>`;

describe('parsePeriodText', () => {
  it('開始・終了とも年つきの期間を読む', () => {
    expect(parsePeriodText('2026年5月14日(木)〜2026年7月5日(日)')).toEqual({
      startsOn: '2026-05-14',
      endsOn: '2026-07-05',
    });
  });

  it('終了年が省略され、月が戻る場合は翌年とみなす (年跨ぎ)', () => {
    // 実データ: 「2025年12月20日〜2月8日」(000000269)
    expect(parsePeriodText('2025年12月20日〜2月8日')).toEqual({
      startsOn: '2025-12-20',
      endsOn: '2026-02-08',
    });
  });

  it('終了年が省略され、月が進む場合は同年', () => {
    expect(parsePeriodText('2026年5月14日〜7月5日')).toEqual({
      startsOn: '2026-05-14',
      endsOn: '2026-07-05',
    });
  });

  it('「日」の脱字を許容する', () => {
    // 実データ: 「2025年11月21（金）」= 「日」が抜けている (000000262 / 000000264 / 000000242)
    expect(parsePeriodText('2025年11月21（金）〜2025年12月14日（日）')).toEqual({
      startsOn: '2025-11-21',
      endsOn: '2025-12-14',
    });
  });

  it('全角数字を受ける', () => {
    expect(parsePeriodText('２０２６年５月１４日〜７月５日')).toEqual({
      startsOn: '2026-05-14',
      endsOn: '2026-07-05',
    });
  });

  it('日付が 1 つだけなら終了日は null', () => {
    expect(parsePeriodText('2026年5月14日〜')).toEqual({
      startsOn: '2026-05-14',
      endsOn: null,
    });
  });

  it('年が読めない場合は推測せず null を返す', () => {
    expect(parsePeriodText('7月下旬より順次')).toEqual({ startsOn: null, endsOn: null });
  });

  // ★ 終了年から開始年を逆算すれば「もっともらしい」値は作れるが、それをやらない。
  //   本モジュールは正解を供給する側であり、推測値を正解として抽出結果を裁くと
  //   「どちらが間違っているのか」が分からなくなる。挙動の意図を固定するテスト。
  it('終了側にだけ年がある場合、開始年を逆算せず全体を null にする', () => {
    expect(parsePeriodText('5月14日〜2026年7月5日')).toEqual({ startsOn: null, endsOn: null });
  });
});

describe('unescapeEmbeddedMarkup', () => {
  it('\\uXXXX と \\&quot; を解く', () => {
    expect(unescapeEmbeddedMarkup('\\u958b\\u50ac')).toBe('開催');
    expect(unescapeEmbeddedMarkup('class=\\&quot;place\\&quot;')).toBe('class="place"');
  });
});

describe('extractSourceTruth', () => {
  it('通常の HTML から会場名と期間を読む', () => {
    const truth = extractSourceTruth(LTR_TOP_PAGE);

    expect(truth.status).toBe('supported');
    expect(truth.matchedVia).toBe('plain');
    expect(truth.venues).toHaveLength(2);
    expect(truth.venues[0]).toMatchObject({
      regionLabel: 'TOKYO',
      // 実体参照が戻っていること。&amp; のままだと全会場が名前不一致になる
      venueLabel: 'BOX cafe&space マツモトキヨシ池袋Part2店',
      startsOn: '2026-05-14',
      endsOn: '2026-07-05',
    });
    expect(truth.venues[1].venueLabel).toBe('BOX cafe&space ＫＩＴＴＥ OSAKA 2号店');
  });

  it('見出し語「【開催期間】」が日付側へ混ざらない', () => {
    const truth = extractSourceTruth(LTR_TOP_PAGE);
    expect(truth.venues[0].periodText).not.toContain('開催期間');
  });

  it('エスケープされた payload でも会場を見つける', () => {
    // ★ この分岐が無いと LTR 8 サイト中 2 つ (miku / nissy) を
    //   「構造が違う」と誤認する。実際に一度誤認した。
    const truth = extractSourceTruth(ESCAPED_PAYLOAD_PAGE);

    expect(truth.status).toBe('supported');
    expect(truth.matchedVia).toBe('escaped');
    expect(truth.venues).toHaveLength(1);
    expect(truth.venues[0]).toMatchObject({
      regionLabel: 'TOKYO',
      venueLabel: 'BOX cafe&space グランドスケープ池袋店',
      startsOn: '2026-08-07',
      endsOn: '2026-09-27',
    });
  });

  it('会場一覧を持たないページは unsupported を返し、推測で埋めない', () => {
    const truth = extractSourceTruth(SUBPAGE_WITHOUT_PLACES);

    expect(truth.status).toBe('unsupported');
    expect(truth.venues).toHaveLength(0);
    expect(truth.reason).toBeDefined();
  });

  it('どの profile で認識したかを返す', () => {
    // 照合が失敗したとき「測る側のどの経路を通ったか」が分からないと切り分けられない。
    expect(extractSourceTruth(LTR_TOP_PAGE).profileId).toBe('ltr');
    expect(extractSourceTruth(HIVELOCITY_TOP_PAGE).profileId).toBe('hivelocity');
    expect(extractSourceTruth(SUBPAGE_WITHOUT_PLACES).profileId).toBeNull();
  });

  it('hivelocity 系のブロック構造から会場名と期間を読む', () => {
    const truth = extractSourceTruth(HIVELOCITY_TOP_PAGE);

    expect(truth.status).toBe('supported');
    expect(truth.venues).toHaveLength(3);
    expect(truth.venues[0]).toMatchObject({
      regionLabel: 'SHIBUYA',
      venueLabel: 'BOX cafe&space GEMS渋谷店',
      startsOn: '2026-04-10',
      endsOn: '2026-06-28',
    });
    expect(truth.venues[1].venueLabel).toBe('Cafe Fan Base');
  });

  // ★ これが本 profile 追加の肝。`h4` 固定で読むと conan-cafe.jp で 10 件中 2 件が
  //   期間なしになる (HARAJUKU / OSAKA（KITTE）が `<p><font>` になっている)。
  it('期間が h4 でなく装飾された p に入っていても読む (実在の装飾差)', () => {
    const truth = extractSourceTruth(HIVELOCITY_TOP_PAGE);

    expect(truth.venues[2]).toMatchObject({
      venueLabel: 'BOX cafe&space キュープラザ原宿店',
      startsOn: '2026-06-11',
      endsOn: '2026-07-19',
    });
  });

  // ★ ページ冒頭の「2026年4月10日（金）～順次開催!!」はイベント全体の惹句であり、
  //   会場ごとの期間ではない。これを各会場へ配ると「測れなかったものを測れたことにする」。
  it('イベント全体リード文の期間を会場ごとの期間へ混入させない', () => {
    const truth = extractSourceTruth(HIVELOCITY_TOP_PAGE);

    // リード文は 4/10〜順次。KANAGAWA の会場は 5/14〜7/26 で、リード文とは無関係。
    expect(truth.venues[1].startsOn).toBe('2026-05-14');
    expect(truth.venues.every((v) => v.periodText?.includes('順次') !== true)).toBe(true);
  });
});

describe('extractPeriodText', () => {
  it('開始・終了とも具体的な日付範囲を切り出す', () => {
    expect(extractPeriodText('【開催期間】 2026年5月14日(木)〜2026年7月5日(日) 会場: BOX cafe')).toBe(
      '2026年5月14日(木)〜2026年7月5日'
    );
  });

  it('終了年が省略された範囲も切り出す (年跨ぎは parsePeriodText が補正)', () => {
    expect(extractPeriodText('2025年12月20日〜2月8日')).toBe('2025年12月20日〜2月8日');
  });

  // ★ 旧実装 (`.place_text_02` 直読み) は開始日だけでも拾えていた。テキスト読みへ
  //   移行する際にこの能力を落とさないためのフォールバック。
  it('終了日が未定でも開始日を落とさない', () => {
    expect(extractPeriodText('2026年4月10日（金）～順次開催!!')).toBe('2026年4月10日（金）～');
    expect(parsePeriodText(extractPeriodText('2026年4月10日（金）より順次')!)).toEqual({
      startsOn: '2026-04-10',
      endsOn: null,
    });
  });

  it('日付が無ければ null を返す (推測で埋めない)', () => {
    expect(extractPeriodText('開催期間は後日発表いたします')).toBeNull();
    expect(extractPeriodText('')).toBeNull();
  });

  // ★ 範囲が取れるなら open-ended フォールバックは発火しない = 実測 18/18 に影響しない
  it('日付範囲がある場合は open-ended フォールバックより優先する', () => {
    expect(extractPeriodText('2026年4月10日 (金) 〜 2026年6月28日 (日)')).toBe(
      '2026年4月10日 (金) 〜 2026年6月28日'
    );
  });
});

describe('compareWithSource', () => {
  const truth = extractSourceTruth(LTR_TOP_PAGE);

  it('会場も期間も一致すれば合格', () => {
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
      { venue_label: 'BOX cafe&space ＫＩＴＴＥ OSAKA 2号店', starts_on: '2026-05-28', ends_on: '2026-06-28' },
    ]);

    expect(result.passed).toBe(true);
    expect(result.countMatches).toBe(true);
    expect(result.missingVenues).toEqual([]);
  });

  it('全角・半角の違いを同一会場として扱う', () => {
    // ★ 実測 (kusuriya run 03): 公式は ＫＩＴＴＥ (全角)、抽出は KITTE (半角)。
    //   正規化しないと同じ会場が「欠落」と「捏造」の 2 件で報告され、
    //   成功した実行を失敗と誤判定する。
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
      { venue_label: 'BOX cafe&space KITTE OSAKA 2号店', starts_on: '2026-05-28', ends_on: '2026-06-28' },
    ]);

    expect(result.missingVenues).toEqual([]);
    expect(result.fabricatedVenues).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('会場の欠落を検出する', () => {
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
    ]);

    expect(result.passed).toBe(false);
    expect(result.countMatches).toBe(false);
    expect(result.missingVenues).toEqual(['BOX cafe&space ＫＩＴＴＥ OSAKA 2号店']);
  });

  it('正解に無い会場を捏造の疑いとして検出する', () => {
    // 実測された捏造: 渋谷のブランド名を大阪の地名へ接ぎ木した会場名
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
      { venue_label: 'BOX cafe&space ＫＩＴＴＥ OSAKA 2号店', starts_on: '2026-05-28', ends_on: '2026-06-28' },
      { venue_label: 'BOX cafe&space SHINSAIBASHI店', starts_on: null, ends_on: null },
    ]);

    expect(result.passed).toBe(false);
    expect(result.fabricatedVenues).toEqual(['BOX cafe&space SHINSAIBASHI店']);
  });

  it('会場は揃っていても期間が違えば不合格', () => {
    // 実測 (kusuriya run 03): 会場名は出たが期間が null だった = 入力に無いものを
    // 名前だけ推測した状態。会場数だけ見ていると合格に見えてしまう。
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
      { venue_label: 'BOX cafe&space ＫＩＴＴＥ OSAKA 2号店', starts_on: null, ends_on: null },
    ]);

    expect(result.countMatches).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.periodMismatches).toEqual(['BOX cafe&space ＫＩＴＴＥ OSAKA 2号店']);
    // ★ 正解側は期間を読めているので「未取得」ではない。ここを取り違えると
    //   本物の不一致が「測る側の問題」として握り潰される。
    expect(result.unmeasuredPeriodVenues).toEqual([]);
  });

  // ★ 正解側で期間が読めていない会場を「不一致」と報告してはいけない。
  //   抽出が正しくても null !== '2026-05-14' で不一致になり、測る側の欠落を
  //   抽出側の誤りとして報告してしまう。原因も対処も違う (再抽出しても直らない)。
  it('正解側で期間を読めなかった会場は不一致でなく照合不能として分離する', () => {
    const truthWithUnreadablePeriod = extractSourceTruth(`
      <div class="place">
        <h2>TOKYO</h2>
        <p class="place_text_01">BOX cafe&amp;space 池袋店</p>
        <p class="place_text_02"><span>【開催期間】</span> 後日発表</p>
      </div>`);

    expect(truthWithUnreadablePeriod.venues[0].startsOn).toBeNull();

    const result = compareWithSource(truthWithUnreadablePeriod, [
      { venue_label: 'BOX cafe&space 池袋店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
    ]);

    expect(result.unmeasuredPeriodVenues).toEqual(['BOX cafe&space 池袋店']);
    expect(result.periodMismatches).toEqual([]);
    // 測れなかったことを不合格にしない (「測れなかった ≠ 間違っていた」)
    expect(result.passed).toBe(true);
  });

  it('照合不能な期間は表示上も不一致と別行にする', () => {
    const truthWithUnreadablePeriod = extractSourceTruth(`
      <div class="place">
        <h2>TOKYO</h2><p class="place_text_01">A店</p>
        <p class="place_text_02">後日発表</p>
      </div>`);
    const lines = formatSourceComparisonLines(
      compareWithSource(truthWithUnreadablePeriod, [
        { venue_label: 'A店', starts_on: '2026-05-14', ends_on: null },
      ])
    );

    expect(lines.some((l) => l.includes('期間を読めなかった会場') && l.includes('A店'))).toBe(true);
    expect(lines.some((l) => l.includes('期間の不一致'))).toBe(false);
  });

  // ★ 実測 (sw2026 run 10/11): 2 件とも渋谷店を返した。生の件数だけを見ると
  //   「正解 2 / 抽出 2」で一致に見えるが、実際には片方の会場が丸ごと落ちている。
  it('同じ会場を 2 回出したら重複として検出し、件数一致に化けさせない', () => {
    const result = compareWithSource(truth, [
      {
        venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店',
        starts_on: '2026-05-14',
        ends_on: '2026-07-05',
      },
      {
        venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店',
        starts_on: '2026-05-14',
        ends_on: '2026-07-05',
      },
    ]);

    expect(result.duplicateVenues).toEqual(['BOX cafe&space マツモトキヨシ池袋Part2店']);
    // 生の件数は 2 でも、重複除去後は 1 件しか無い
    expect(result.actualCount).toBe(2);
    expect(result.actualUniqueCount).toBe(1);
    expect(result.countMatches).toBe(false);
    expect(result.passed).toBe(false);
    // 落ちている会場も同時に報告されること
    expect(result.missingVenues).toEqual(['BOX cafe&space ＫＩＴＴＥ OSAKA 2号店']);
  });

  it('全角・半角の違いで重複しているケースも重複として検出する', () => {
    // 正規化キーで畳むため、表記が違っても同一会場の重複として拾える
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space ＫＩＴＴＥ OSAKA 2号店', starts_on: '2026-05-28', ends_on: '2026-06-28' },
      { venue_label: 'BOX cafe&space KITTE OSAKA 2号店', starts_on: '2026-05-28', ends_on: '2026-06-28' },
    ]);

    expect(result.duplicateVenues).toEqual(['BOX cafe&space KITTE OSAKA 2号店']);
    expect(result.actualUniqueCount).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('照合不能なページは合格にしない', () => {
    // 「測れなかった」を「正しかった」と混同させない。
    const unsupported = extractSourceTruth(SUBPAGE_WITHOUT_PLACES);
    const result = compareWithSource(unsupported, [
      { venue_label: 'なんらかの会場', starts_on: '2026-05-14', ends_on: '2026-07-05' },
    ]);

    expect(result.status).toBe('unsupported');
    expect(result.passed).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

// ★ 4 巡目レビュー由来。件数の食い違いの理由を名指しする。
describe('件数の内訳表示', () => {
  const truth = extractSourceTruth(LTR_TOP_PAGE);

  it('重複が原因なら「重複」と名指しする', () => {
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
    ]);

    expect(formatOccurrenceCountBreakdown(result)).toContain('重複 1 会場');
    expect(formatOccurrenceCountBreakdown(result)).not.toContain('会場名が空');
  });

  // ★ venue_label が空の occurrence は照合できず落とされる。これを「重複除去後」と
  //   書くと原因を誤らせる (重複していないのに重複と読める)。
  it('会場名が空なら「会場名が空」と名指しし、重複とは書かない', () => {
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
      { venue_label: 'BOX cafe&space ＫＩＴＴＥ OSAKA 2号店', starts_on: '2026-05-28', ends_on: '2026-06-28' },
      { venue_label: null, starts_on: null, ends_on: null },
      { venue_label: '   ', starts_on: null, ends_on: null },
    ]);

    expect(result.missingVenueLabelCount).toBe(2);
    expect(result.duplicateVenues).toEqual([]);
    const breakdown = formatOccurrenceCountBreakdown(result);
    expect(breakdown).toContain('会場名が空 2 件');
    expect(breakdown).not.toContain('重複');
  });

  it('食い違いが無ければ内訳を出さない', () => {
    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
      { venue_label: 'BOX cafe&space ＫＩＴＴＥ OSAKA 2号店', starts_on: '2026-05-28', ends_on: '2026-06-28' },
    ]);

    expect(formatOccurrenceCountBreakdown(result)).toBe('');
  });
});

// ★ 4 巡目レビュー由来 (1 巡目からの持ち越し)。抽出側と対称に扱う。
describe('正解データ側の会場名重複', () => {
  /** 正規化後に同じキーになる 2 会場を掲載しているページ。 */
  const COLLIDING_SOURCE = `
<!DOCTYPE html><html><body>
  <div class="place">
    <h2>TOKYO</h2>
    <p class="place_text_01">BOX cafe&amp;space ＫＩＴＴＥ OSAKA 2号店</p>
    <p class="place_text_02"><span>【開催期間】</span> 2026年5月14日(木)〜2026年7月5日(日)</p>
  </div>
  <div class="place">
    <h2>OSAKA</h2>
    <p class="place_text_01">BOX cafe&amp;space KITTE OSAKA 2号店</p>
    <p class="place_text_02"><span>【開催期間】</span> 2026年5月28日(木)〜2026年6月28日(日)</p>
  </div>
</body></html>`;

  it('正解側の衝突を検出し、黙って畳まない', () => {
    const truth = extractSourceTruth(COLLIDING_SOURCE);
    expect(truth.venues).toHaveLength(2);

    const result = compareWithSource(truth, [
      { venue_label: 'BOX cafe&space KITTE OSAKA 2号店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
    ]);

    // 正解データが 2 会場あるのに expectedCount は 1 になる = 測る側が壊れている
    expect(result.duplicateSourceVenues).toHaveLength(1);
    expect(result.expectedCount).toBe(1);
  });

  // ★ 7 巡目レビュー由来。`compareWithSource` は実行ごとにループから呼ばれるため、
  //   関数内で warn すると同じ警告が実行回数ぶん重複する。警告は呼び出し側で 1 回。
  it('compareWithSource は warn しない (副作用を持たない)', () => {
    const truth = extractSourceTruth(COLLIDING_SOURCE);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    compareWithSource(truth, []);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('warnOnceForSourceIssues が警告を出し、出したことを返す', () => {
    const truth = extractSourceTruth(COLLIDING_SOURCE);
    const result = compareWithSource(truth, []);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(warnOnceForSourceIssues(result)).toBe(true);
    const message = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('正解データ側で会場名が重複');
    warnSpy.mockRestore();
  });

  it('衝突が無ければ warnOnceForSourceIssues は何もしない', () => {
    const truth = extractSourceTruth(LTR_TOP_PAGE);
    const result = compareWithSource(truth, []);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(warnOnceForSourceIssues(result)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('会場名が異なる通常のページでは空 (偽陽性を出さない)', () => {
    const truth = extractSourceTruth(LTR_TOP_PAGE);
    const result = compareWithSource(truth, []);

    expect(result.duplicateSourceVenues).toEqual([]);
    expect(result.expectedCount).toBe(2);
  });
});
