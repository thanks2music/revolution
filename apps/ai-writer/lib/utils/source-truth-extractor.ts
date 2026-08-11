/**
 * Source Truth Extractor — 公式サイトの HTML から「会場と期間の正解データ」を
 * LLM を使わずに取り出す。
 *
 * ## なぜ LLM を使わないか
 *
 * 抽出パイプラインの正しさを測る物差しに LLM を使うと、**測る側も間違える**ので
 * 不一致が出たときにどちらが誤りか判別できない。正解データは決定論的に作る必要がある。
 *
 * ## 何を根拠にしているか (実測、2026-08-11 / 2026-08-12)
 *
 * LTR 系 8 サイトの保存 HTML を総当たりしたところ、**全サイトが
 * `.place` × N ＝ 会場数**の構造を持っていた。
 *
 * ```html
 * <div class="info-container">
 *   <div class="place"><h2>TOKYO</h2>
 *     <p class="place_text_01">BOX cafe&space SHIBUYA109渋谷店</p>
 *     <p class="place_text_02"><span>【開催期間】</span> 2026年6月4日(木)〜2026年8月16日(日)</p>
 * ```
 *
 * ⚠️ **`miku-wa-modern-cafe` と `nissy-cafe-2026` は HTML が `\uXXXX` /
 * `\&quot;` でエスケープされた JSON payload に埋まっている。** 生の文字列検索では
 * `.place` が 0 件に見え、実際に一度「この 2 サイトは構造が違う」と誤認した。
 * エスケープを解いてから再パースすると 3 件 / 7 件が現れる。**この 1 手が無いと
 * 2 サイトを取りこぼす。**
 *
 * ## 適用範囲
 *
 * `.place` 構造は LTR 系サイト固有である。本モジュールは**検証ツール**であり、
 * 抽出パイプライン本体ではないため、この依存は許容する
 * (「LTR 固有の対症療法にしない」方針はパイプライン改修に対するもの)。
 * 構造の異なるサイトは推測で埋めず `unsupported` を返し、**黙って合格にしない**。
 *
 * ## 既知の限界 (実測で確認済み、意図的に受容)
 *
 * `nissy-cafe-2026` の 7 番目の `.place` は `GiGO` 系 6 店舗ぶんの名称が 1 ブロックに
 * 連結されている。パイプライン側がこれを複数 occurrence へ分割すると、本モジュールは
 * 「正解に無い会場」として報告する。**これは偽陽性であり許容する** — 偽陰性
 * (間違いを見逃す) と違い、人が見て握り潰せるため。逆向きに寛容化して連結ブロックを
 * 無視すると、本物の欠落まで見逃す。
 *
 * @module lib/utils/source-truth-extractor
 */

import * as cheerio from 'cheerio';

/**
 * cheerio v1 は `Element` を re-export せず、`domhandler` も直接の依存ではない。
 * セレクションの型は API の戻り値から導出する。
 */
type PlaceSelection = ReturnType<cheerio.CheerioAPI>;

/** 公式サイトから読み取った 1 会場ぶんの事実。 */
export interface SourceTruthVenue {
  /** ブロック見出し (`TOKYO` / `OSAKA` 等)。地域ラベルであって都道府県名ではない */
  regionLabel: string | null;
  /** 会場名 (`.place_text_01`) */
  venueLabel: string | null;
  /** 【開催期間】欄の生テキスト。日付の解釈は呼び出し側に委ねる */
  periodText: string | null;
  /** `periodText` から取り出した開始日 (`YYYY-MM-DD`)。解釈できなければ null */
  startsOn: string | null;
  /** 同終了日。年が省略されていた場合は開始年で補う */
  endsOn: string | null;
}

export interface SourceTruth {
  /** `supported` = 構造を認識できた / `unsupported` = 認識できず照合不能 */
  status: 'supported' | 'unsupported';
  /** 認識に使った経路。`escaped` はエスケープ解除後に一致したことを示す */
  matchedVia: 'plain' | 'escaped' | null;
  venues: SourceTruthVenue[];
  /** `unsupported` のときの理由 (人が読む用) */
  reason?: string;
}

/**
 * `\uXXXX` / `\&quot;` / `\/` 等のエスケープを解く。
 *
 * miku / nissy のようにマークアップが JSON payload へ埋め込まれているケースを
 * 救うための前処理。JSON.parse は使えない (payload 全体が JSON とは限らない)。
 */
export function unescapeEmbeddedMarkup(html: string): string {
  return html
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\&quot;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, '\n');
}

/** 全角数字を半角へ。`ＫＩＴＴＥ` のような会場名は変換しない (数字のみ対象)。 */
function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 「2026年5月14日(木)〜2026年7月5日(日)」形式から開始日・終了日を取り出す。
 *
 * - 終了側の年が省略された「2025年12月20日〜2月8日」は**開始年で補ったうえで、
 *   月が戻る場合は翌年**とみなす (年跨ぎ)。`occurrence-normalizer.ts` の年跨ぎ補正と
 *   同じ考え方。
 * - 曜日の脱字 (`2025年11月21（金）` のように「日」が無い) は実データに存在するため、
 *   「日」を任意扱いにして受ける。
 */
export function parsePeriodText(periodText: string): {
  startsOn: string | null;
  endsOn: string | null;
} {
  const text = toHalfWidthDigits(periodText);
  const pattern = /(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日?/g;

  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return { startsOn: null, endsOn: null };

  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const [first] = matches;
  const startYear = first[1] ? Number(first[1]) : null;
  if (startYear === null) return { startsOn: null, endsOn: null };

  const startMonth = Number(first[2]);
  const startsOn = iso(startYear, startMonth, Number(first[3]));

  if (matches.length < 2) return { startsOn, endsOn: null };

  const second = matches[1];
  const endMonth = Number(second[2]);
  // 終了年が省略されている場合、月が戻っていれば翌年 (年跨ぎ)
  const endYear = second[1] ? Number(second[1]) : endMonth < startMonth ? startYear + 1 : startYear;

  return { startsOn, endsOn: iso(endYear, endMonth, Number(second[3])) };
}

/**
 * 実体参照を戻す。
 *
 * エスケープ経路 (miku / nissy) では元の HTML が二重エスケープされているため、
 * cheerio が 1 段解いても `&amp;` が残る。会場名に `BOX cafe&space` のように `&` を
 * 含むものが多く、放置すると**全会場が名前不一致になる**。
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

/** `.place` ブロックを 1 つ読み取る。 */
function readPlaceBlock($el: PlaceSelection): SourceTruthVenue {
  const norm = (value: string | undefined): string | null => {
    const trimmed = decodeEntities(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const regionLabel = norm($el.find('h2').first().text());
  const venueLabel = norm($el.find('.place_text_01').first().text());

  // 【開催期間】は `.place_text_02` の中に `<span>【開催期間】</span> 日付` の形で入る。
  // span を落としてから読むことで見出し語が日付側へ混ざらないようにする。
  const $period = $el.find('.place_text_02').first().clone();
  $period.find('span').remove();
  const periodText = norm($period.text());

  const { startsOn, endsOn } = periodText
    ? parsePeriodText(periodText)
    : { startsOn: null, endsOn: null };

  return { regionLabel, venueLabel, periodText, startsOn, endsOn };
}

/** 与えた HTML から `.place` ブロックを列挙する。 */
function collectPlaces(html: string): SourceTruthVenue[] {
  const $ = cheerio.load(html);
  return $('.place')
    .toArray()
    .map((el) => readPlaceBlock($(el)));
}

/**
 * 公式サイトの HTML から会場と期間の正解データを取り出す。
 *
 * 生のままで `.place` が見つからない場合はエスケープを解いて再試行する。
 * それでも見つからなければ `unsupported` を返す — **推測で埋めない**。
 */
export function extractSourceTruth(html: string): SourceTruth {
  const plain = collectPlaces(html);
  if (plain.length > 0) {
    return { status: 'supported', matchedVia: 'plain', venues: plain };
  }

  // ★ miku / nissy はここで初めて見つかる。この分岐が無いと 8 サイト中 2 つを
  //   「構造が違う」と誤認する (実際に一度誤認した)。
  const escaped = collectPlaces(unescapeEmbeddedMarkup(html));
  if (escaped.length > 0) {
    return { status: 'supported', matchedVia: 'escaped', venues: escaped };
  }

  return {
    status: 'unsupported',
    matchedVia: null,
    venues: [],
    reason:
      '`.place` ブロックが見つかりません (エスケープ解除後も 0 件)。LTR 系以外のサイト構造か、取得したページが会場一覧を含まない下層ページの可能性があります。',
  };
}

// ── 抽出結果との突き合わせ ────────────────────────────────────────────

/** パイプラインが出した 1 開催ぶん (`event_data.occurrences[]` の必要部分)。 */
export interface ExtractedOccurrence {
  venue_label?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
}

export interface VenueComparison {
  venueLabel: string;
  /** 正解・抽出の双方に存在するか */
  presence: 'both' | 'missing-from-extraction' | 'not-in-source';
  expected?: { startsOn: string | null; endsOn: string | null };
  actual?: { startsOn: string | null; endsOn: string | null };
  periodMatches?: boolean;
}

export interface SourceComparison {
  status: 'supported' | 'unsupported';
  /** 会場数の一致 */
  countMatches: boolean;
  expectedCount: number;
  actualCount: number;
  /** 会場名の集合比較 */
  venues: VenueComparison[];
  /** 正解にあるのに抽出に無い会場 (= 欠落。最も重い) */
  missingVenues: string[];
  /** 抽出にあるのに正解に無い会場 (= 捏造の疑い) */
  fabricatedVenues: string[];
  /** 期間が食い違う会場 */
  periodMismatches: string[];
  /** 総合判定。`unsupported` のときは常に false (黙って合格にしない) */
  passed: boolean;
  reason?: string;
}

/**
 * 会場名の照合キー。表示用の文字列は変えず、比較のときだけ揺れを吸収する。
 *
 * **NFKC 正規化が必須。** 実測 (2026-08-11、kusuriya 3 回) で、公式サイトが
 * `ＫＩＴＴＥ OSAKA 2号店` (全角ラテン) と書いているのに対し、抽出結果は
 * `KITTE OSAKA 2号店` (半角) を返した。単純比較では**同一会場が「欠落」と
 * 「捏造」の 2 件として報告され**、実際には成功していた実行を失敗と誤判定する。
 *
 * 偽陽性は許容する方針だが、これは系統的に発生して本物の欠落を埋もれさせるため
 * 潰しておく。NFKC は全角英数・全角記号・半角カナを標準形へ畳むだけで、
 * 別の会場どうしを取り違える方向には働かない。
 */
function normalizeVenueKey(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/[\s　]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 正解データと抽出結果を突き合わせる。
 *
 * 会場数 → 会場名 → 期間 の 3 段を**独立に**報告する。1 つの真偽値に潰すと
 * 「どこで壊れたか」が失われ、次の一手が決められない。
 */
export function compareWithSource(
  truth: SourceTruth,
  occurrences: ExtractedOccurrence[]
): SourceComparison {
  if (truth.status === 'unsupported') {
    return {
      status: 'unsupported',
      countMatches: false,
      expectedCount: 0,
      actualCount: occurrences.length,
      venues: [],
      missingVenues: [],
      fabricatedVenues: [],
      periodMismatches: [],
      // ★ 照合できないものを合格にしない。「測れなかった」と「正しかった」は別。
      passed: false,
      reason: truth.reason,
    };
  }

  const expected = new Map<string, SourceTruthVenue>();
  for (const v of truth.venues) {
    if (v.venueLabel) expected.set(normalizeVenueKey(v.venueLabel), v);
  }

  const actual = new Map<string, ExtractedOccurrence>();
  for (const o of occurrences) {
    if (o.venue_label) actual.set(normalizeVenueKey(o.venue_label), o);
  }

  const venues: VenueComparison[] = [];
  const missingVenues: string[] = [];
  const fabricatedVenues: string[] = [];
  const periodMismatches: string[] = [];

  for (const [key, source] of expected) {
    const found = actual.get(key);
    if (!found) {
      missingVenues.push(source.venueLabel!);
      venues.push({
        venueLabel: source.venueLabel!,
        presence: 'missing-from-extraction',
        expected: { startsOn: source.startsOn, endsOn: source.endsOn },
      });
      continue;
    }

    const periodMatches =
      (source.startsOn ?? null) === (found.starts_on ?? null) &&
      (source.endsOn ?? null) === (found.ends_on ?? null);
    if (!periodMatches) periodMismatches.push(source.venueLabel!);

    venues.push({
      venueLabel: source.venueLabel!,
      presence: 'both',
      expected: { startsOn: source.startsOn, endsOn: source.endsOn },
      actual: { startsOn: found.starts_on ?? null, endsOn: found.ends_on ?? null },
      periodMatches,
    });
  }

  for (const [key, found] of actual) {
    if (expected.has(key)) continue;
    fabricatedVenues.push(found.venue_label!);
    venues.push({
      venueLabel: found.venue_label!,
      presence: 'not-in-source',
      actual: { startsOn: found.starts_on ?? null, endsOn: found.ends_on ?? null },
    });
  }

  const expectedCount = expected.size;
  const actualCount = occurrences.length;

  return {
    status: 'supported',
    countMatches: expectedCount === actualCount,
    expectedCount,
    actualCount,
    venues,
    missingVenues,
    fabricatedVenues,
    periodMismatches,
    passed:
      missingVenues.length === 0 &&
      fabricatedVenues.length === 0 &&
      periodMismatches.length === 0,
  };
}
