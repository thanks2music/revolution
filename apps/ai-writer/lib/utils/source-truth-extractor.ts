/**
 * Source Truth Extractor — 公式サイトの HTML から「会場と期間の正解データ」を
 * LLM を使わずに取り出す。
 *
 * ## なぜ LLM を使わないか
 *
 * 抽出パイプラインの正しさを測る物差しに LLM を使うと、**測る側も間違える**ので
 * 不一致が出たときにどちらが誤りか判別できない。正解データは決定論的に作る必要がある。
 *
 * ## 何を根拠にしているか (実測、2026-08-11 / 2026-08-12 / 2026-08-13)
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
 * 2026-08-13 に **hivelocity 系** (`conan-cafe.jp` / `jujutsukaisen-cafe.jp`) を追加した。
 * ブロックは `.p-top-information__bloc`、地域は `h2`、会場名は `h3`。
 *
 * ⚠️ **`miku-wa-modern-cafe` と `nissy-cafe-2026` は HTML が `\uXXXX` /
 * `\&quot;` でエスケープされた JSON payload に埋まっている。** 生の文字列検索では
 * `.place` が 0 件に見え、実際に一度「この 2 サイトは構造が違う」と誤認した。
 * エスケープを解いてから再パースすると 3 件 / 7 件が現れる。**この 1 手が無いと
 * 2 サイトを取りこぼす。**
 *
 * ## 適用範囲
 *
 * ブロック構造はサイト系列ごとに異なるため `SITE_PROFILES` で列挙する。本モジュールは
 * **検証ツール**であり抽出パイプライン本体ではないため、このサイト固有知識は許容する
 * (「LTR 固有の対症療法にしない」方針はパイプライン改修に対するもの)。
 * 構造の異なるサイトは推測で埋めず `unsupported` を返し、**黙って合格にしない**。
 *
 * ⚠️ **profile の追加は実測に基づくものだけに限る。** 「たぶんこの class 名だろう」で
 * 足すと、誤ったセレクタが誤った正解データを作り、**正しい抽出結果を失格にする**。
 * 追加時は必ず実サイトを取得し、会場数と会場名が公式表示と一致することを確認する。
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
  /**
   * 期間テキストの読み取り種別 (`readPeriod` の判定)。
   *
   * ⚠️ **`endsOn === null` の理由がこれで分かれる。** `open-ended` は「公式が終了日を
   * 書いていない」= それが事実。`unreadable` は「書いてあるのに読めなかった」= 測る側の
   * 欠落。前者は比較してよく、後者は比較してはいけない (`compareWithSource` 参照)。
   */
  periodKind: PeriodReadingKind;
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
  /** 認識に使った profile の id。`unsupported` なら null */
  profileId: SiteProfileId | null;
  venues: SourceTruthVenue[];
  /** `unsupported` のときの理由 (人が読む用) */
  reason?: string;
}

export type SiteProfileId = 'ltr' | 'hivelocity';

/**
 * 会場ブロックの構造をサイト系列ごとに宣言する。
 *
 * ## 期間セレクタを持たない理由 (実測で決定、2026-08-13)
 *
 * 当初は系列ごとに期間のセレクタ (`.place_text_02` / `h4`) を持たせる設計だったが、
 * **hivelocity は `h4` が 10 件中 2 件で空**だった (`conan-cafe.jp` の HARAJUKU と
 * OSAKA（KITTE）。サイト側の装飾差で `<p style="color:#dd3333"><font size=5>` に
 * なっている)。タグ固定で読むと**この 2 件が黙って期間なしになる**。
 *
 * そこで**ブロック内テキストから日付範囲を正規表現で読む**方式に変えたところ、
 * 5 サイト 18 会場すべてで期間が取れた。さらに LTR 3 サイトでは
 * **セレクタ経路と正規表現経路の結果が 5/5 完全一致**したため、
 * LTR 専用の期間セレクタを残す理由が実測で消えた。よって期間は profile に持たせず
 * 一律テキスト読みにする。
 */
interface SiteProfile {
  id: SiteProfileId;
  /** 1 会場 = 1 ブロックとなる要素 */
  blockSelector: string;
  /** ブロック内の地域見出し (`TOKYO` / `SHIBUYA` 等) */
  regionSelector: string;
  /** ブロック内の会場名 */
  venueSelector: string;
}

/** 実測で確認済みの profile のみを並べる。先に一致したものを採用する。 */
const SITE_PROFILES: readonly SiteProfile[] = [
  // LTR 系 8 サイト (実測 2026-08-11)
  { id: 'ltr', blockSelector: '.place', regionSelector: 'h2', venueSelector: '.place_text_01' },
  // hivelocity 系: conan-cafe.jp (10 会場) / jujutsukaisen-cafe.jp (3 会場) (実測 2026-08-13)
  {
    id: 'hivelocity',
    blockSelector: '.p-top-information__bloc',
    regionSelector: 'h2',
    venueSelector: 'h3',
  },
];

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
 *
 * ## ⚠️ 開始側の年が無ければ全体を null にする (意図的)
 *
 * `5月14日〜2026年7月5日` のように**終了側にだけ年がある**場合、終了年から開始年を
 * 逆算すれば「もっともらしい」値は作れる。**それをやらない。**
 *
 * 本モジュールは「正解」を供給する側であり、ここで推測を入れると
 * **推測値を正解として抽出結果を裁く**ことになる。誤った正解で失敗判定を出すのは、
 * 判定しないより悪い (どちらが間違っているのか分からなくなる)。
 *
 * 開始年が読めないなら `{ startsOn: null, endsOn: null }` を返し、呼び出し側には
 * 「この会場の期間は照合できない」として扱わせる。年跨ぎ補正 (上記) を入れているのは
 * **開始年が確定しているとき限定**で、そこから機械的に決まる範囲に留めている。
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

/**
 * 「開始日 〜 終了日」の日付範囲。開始・終了とも具体的な日付であることを要求する。
 *
 * 間の `[^0-9]{0,12}?` は曜日表記 (`(金)` / `（日）`) と空白を跨ぐためのもの。
 * 終了側の `\d{0,4}年?` は年の省略 (`2025年12月20日〜2月8日`) を許す。
 */
const DATE_RANGE =
  /(\d{4}年\s*\d{1,2}月\s*\d{1,2}日[^0-9]{0,12}?[〜~～-][^0-9]{0,12}?\d{0,4}年?\s*\d{1,2}月\s*\d{1,2}日)/;

/**
 * 終了日が未定の期間 (`2026年4月10日（金）～順次開催!!` / `〜` で切れている等)。
 *
 * ## なぜフォールバックとして持つか
 *
 * `DATE_RANGE` は終了日を要求するため open-ended を弾く。旧実装 (LTR の
 * `.place_text_02` 直読み) は開始日だけでも拾えていたので、テキスト読みへ移行する際に
 * **その能力を落とさない**ために置く。`DATE_RANGE` が一致した場合は使われないため、
 * 実測 18/18 の結果には影響しない (発火経路が排他)。
 *
 * ⚠️ **イベント全体のリード文にある期間を会場へ配ってはいけない。** 実データでは
 * `conan-cafe.jp` / `kusuriya-cafe` ともページ冒頭の惹句が
 * 「…期間限定オープン！！ 2026年4月10日（金）～順次開催!!」の形を持つが、これは
 * イベント全体の話であって会場ごとの期間ではない。本正規表現は**会場ブロック内の
 * テキストだけ**に当てる (`readVenueBlock` が `$block.text()` を渡す) ことでこれを担保する。
 */
const OPEN_ENDED_PERIOD = /(\d{4}年\s*\d{1,2}月\s*\d{1,2}日[^0-9]{0,12}?(?:[〜~～-]|より|から))/;

/** 空白を潰し実体参照を戻す。空文字列は null に畳む。 */
function norm(value: string | undefined): string | null {
  const trimmed = decodeEntities(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `OPEN_ENDED_PERIOD` の後ろに**別の日付が続いているか**の判定用。
 *
 * 年は省略されうる (`2026年4月10日より 5月20日まで`) ため月日だけで足りる。
 * 全角数字も拾うのは、**検出側が抽出側より緩いのは安全な方向**だから
 * (緩いほど「読めなかった」に倒れ、判定を控える側に働く)。
 */
const TRAILING_DATE = /\d{1,2}\s*月\s*\d{1,2}/;

/** 期間テキストの読み取り結果の種別。 */
export type PeriodReadingKind =
  /** 開始日と終了日の両方が読めた */
  | 'dated'
  /** 開始日だけがあり、**公式サイトが終了日を書いていない** (`〜順次開催` 等) */
  | 'open-ended'
  /** 終了日が**書かれているのに読めなかった** (`◯月◯日より △月△日まで` 等) */
  | 'unreadable'
  /** 日付の記述そのものが無い */
  | 'absent';

export interface PeriodReading {
  kind: PeriodReadingKind;
  /** 切り出した期間テキスト。`absent` は null */
  text: string | null;
}

/**
 * ブロック内テキストから期間の記述を読み取り、**3 つの状態を区別して**返す。
 *
 * ## なぜ `open-ended` と `unreadable` を分けるのか (2026-08-13 追加、Step B-2)
 *
 * `OPEN_ENDED_PERIOD` は範囲マーカーとして `より` / `から` も拾うが、`DATE_RANGE` は
 * `〜~～-` しか受けない。そのため **「◯月◯日より △月△日まで」表記のサイトでは
 * 終了日が書いてあるのに `DATE_RANGE` が外れ、フォールバックが開始日だけを拾う**。
 *
 * 両者を `open-ended` に混ぜると、正解側の `endsOn` が null になり、抽出側が終了日を
 * **正しく**読めていても `periodMismatches` に入る。これは `compareWithSource` が
 * 開始日側で明示的に禁じている「**測る側の欠落を抽出側の誤りとして報告する**」事故
 * そのもの (下記 `source.startsOn === null` のガードを参照)。
 *
 * よって「後ろに別の日付が続いているか」で分ける:
 *
 * | 入力 | 判定 | 比較時の扱い |
 * |---|---|---|
 * | `2026年4月10日（金）～2026年6月28日（日）` | `dated` | 開始・終了とも比較する |
 * | `2026年4月10日（金）～順次開催!!` | `open-ended` | 比較する (**正解の終了日は「無い」が事実**。抽出が終了日を出したら捏造として検出したい) |
 * | `2026年4月10日（金）より 5月20日（水）まで` | `unreadable` | **比較しない** (`unmeasuredPeriodVenues`) |
 * | `開催期間は後日発表いたします` | `absent` | 比較しない |
 *
 * ⚠️ **`unreadable` へ倒れるのは意図的に緩い。** ブロック内に会場の期間とは無関係な
 * 日付 (予約開始日・更新日等) があると、真の open-ended でも `unreadable` と判定する。
 * これは claude[bot] が指摘した「ブロック内の先頭マッチを拾う」設計の一般化リスクと
 * 同根で、**判定を控える方向の誤りなので許容する**。誤って「不一致」を出して正しい
 * 抽出結果を失格にするより、「照合できない」と申告する方が安全 (`unmeasuredPeriodVenues`
 * は `passed` に含めない)。逆向きに倒すには profile ごとの期間セレクタが必要になるが、
 * それは実測で棄却された経路 (上記 `SITE_PROFILES` の docstring 参照)。
 *
 * ⚠️ **`TRAILING_DATE` はブロック末尾まで走査する。** そのため会場ブロックに周辺コピーが
 * 多いサイトでは、真の open-ended でも離れた位置の無関係な日付 (予約開始日・更新日等) を
 * 拾って `unreadable` に倒れうる。**走査窓を狭める / 文の区切りで打ち切るといった対策は
 * 現時点では入れない** — 実測 5 サイト 18 会場にその形の入力が 1 件も無く、**サンプル無しで
 * ヒューリスティクスを足すのは `SITE_PROFILES` に定めた「追加は実測に基づくものだけ」に
 * 反する**ため。**Sprint E で profile を増やす際に実データで再評価する** (そこが顕在化
 * しうる最初の地点。claude[bot] が PR #300 で同じ懸念を指摘し、follow-up note を残す
 * 判断で合意している)。
 */
export function readPeriod(blockText: string): PeriodReading {
  const text = norm(blockText) ?? '';

  const dated = text.match(DATE_RANGE)?.[1];
  if (dated) return { kind: 'dated', text: dated };

  const open = text.match(OPEN_ENDED_PERIOD);
  if (!open || open.index === undefined) return { kind: 'absent', text: null };

  const tail = toHalfWidthDigits(text.slice(open.index + open[1].length));
  return {
    kind: TRAILING_DATE.test(tail) ? 'unreadable' : 'open-ended',
    text: open[1],
  };
}

/**
 * ブロック内テキストから期間の記述を切り出す。
 *
 * 見つからなければ null = **「この会場の期間は読めなかった」**。呼び出し側はこれを
 * 「期間が一致しない」ではなく「照合できない」として扱う (`unmeasuredPeriodVenues`)。
 * 読めなかったものを 0 や推測値で埋めると、正しい抽出結果を失格にする。
 *
 * **切り出した文字列だけが必要な場合の薄いラッパ**。`open-ended` と `unreadable` の
 * 区別が要る場所では `readPeriod` を直接使う (両者を 1 箇所で決めるため、正規表現の
 * 判定ロジックは `readPeriod` にしか置かない)。
 */
export function extractPeriodText(blockText: string): string | null {
  return readPeriod(blockText).text;
}

/** 会場ブロックを 1 つ読み取る。 */
function readVenueBlock($el: PlaceSelection, profile: SiteProfile): SourceTruthVenue {
  const regionLabel = norm($el.find(profile.regionSelector).first().text());
  const venueLabel = norm($el.find(profile.venueSelector).first().text());
  const { kind: periodKind, text: periodText } = readPeriod($el.text());

  const { startsOn, endsOn } = periodText
    ? parsePeriodText(periodText)
    : { startsOn: null, endsOn: null };

  return { regionLabel, venueLabel, periodText, periodKind, startsOn, endsOn };
}

/**
 * 与えた HTML から会場ブロックを列挙する。
 *
 * `SITE_PROFILES` を順に試し、**最初にブロックが 1 件以上見つかった profile を採用**する。
 * 見つからなければ null (呼び出し側がエスケープ解除して再試行する)。
 */
function collectVenues(
  html: string
): { profile: SiteProfile; venues: SourceTruthVenue[] } | null {
  const $ = cheerio.load(html);
  for (const profile of SITE_PROFILES) {
    const blocks = $(profile.blockSelector).toArray();
    if (blocks.length === 0) continue;
    return { profile, venues: blocks.map((el) => readVenueBlock($(el), profile)) };
  }
  return null;
}

/**
 * 公式サイトの HTML から会場と期間の正解データを取り出す。
 *
 * 生のままで `.place` が見つからない場合はエスケープを解いて再試行する。
 * それでも見つからなければ `unsupported` を返す — **推測で埋めない**。
 */
export function extractSourceTruth(html: string): SourceTruth {
  const plain = collectVenues(html);
  if (plain) {
    return {
      status: 'supported',
      matchedVia: 'plain',
      profileId: plain.profile.id,
      venues: plain.venues,
    };
  }

  // ★ miku / nissy はここで初めて見つかる。この分岐が無いと 8 サイト中 2 つを
  //   「構造が違う」と誤認する (実際に一度誤認した)。
  const escaped = collectVenues(unescapeEmbeddedMarkup(html));
  if (escaped) {
    return {
      status: 'supported',
      matchedVia: 'escaped',
      profileId: escaped.profile.id,
      venues: escaped.venues,
    };
  }

  return {
    status: 'unsupported',
    matchedVia: null,
    profileId: null,
    venues: [],
    reason:
      `既知の会場ブロック構造が見つかりません (試した profile: ${SITE_PROFILES.map((p) => `${p.id} = \`${p.blockSelector}\``).join(' / ')}。エスケープ解除後も 0 件)。` +
      '未対応のサイト系列か、取得したページが会場一覧を含まない下層ページの可能性があります。',
  };
}

// ── 抽出結果との突き合わせ ────────────────────────────────────────────

/**
 * パイプラインが出した 1 開催ぶん (`event_data.occurrences[]` の必要部分)。
 *
 * ⚠️ **キーを optional にしない。** 以前は全フィールドが `?:` だったため、
 * camelCase の別型 (`{ venueLabel, startsOn, endsOn }`) を渡しても型チェックを
 * 通過し、`compareWithSource` が全会場を「欠落」と報告する不具合を実際に作った
 * (2026-08-12)。値の欠如は `null` で表し、キーの有無では表さない。
 */
export interface ExtractedOccurrence {
  venue_label: string | null;
  starts_on: string | null;
  ends_on: string | null;
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
  /** 会場数の一致。**重複を除いた件数** (`actualUniqueCount`) で判定する */
  countMatches: boolean;
  expectedCount: number;
  /**
   * 抽出が返した occurrences の**生の件数** (重複を含む)。
   *
   * ⚠️ これと `actualUniqueCount` が食い違う = 同じ会場を 2 回出している。
   */
  actualCount: number;
  /**
   * 会場名を正規化キーで畳んだあとの件数。
   *
   * 実測 (2026-08-11、sw2026 run 10/11) で **2 件とも渋谷店**を返した実行があった。
   * 生の件数だけを見ると「正解 2 / 抽出 2」で一致に見えるが、実際には片方の会場が
   * 丸ごと落ちている。判定にはこちらを使う。
   */
  actualUniqueCount: number;
  /**
   * 抽出結果の中で正規化キーが衝突した会場名 (= 同じ会場を複数回出した)。
   *
   * 引き継ぎ書 R7 が挙げる既知の欠陥そのもの。空でなければ `passed` は false。
   */
  duplicateVenues: string[];
  /**
   * **正解データ側**で正規化キーが衝突した会場名。
   *
   * ⚠️ 公式サイトが正規化後に同じキーになる 2 会場を掲載していると、正解から
   * 片方が消えて `expectedCount` が過少になる。**測る側が壊れている状態**なので
   * 抽出側の欠陥より重い。`passed` を false にはしない (抽出の是非とは別問題)が、
   * 警告として必ず表に出す。
   *
   * 実測 8 サイトでは会場名がすべて異なるため空。
   */
  duplicateSourceVenues: string[];
  /**
   * 抽出結果のうち `venue_label` が空だった occurrence の数。
   *
   * ⚠️ これがあると `actualCount` と `actualUniqueCount` が食い違うが、**理由は重複
   * ではない**。両者の差を「重複」と決めつけて表示すると原因を誤らせる。
   */
  missingVenueLabelCount: number;
  /** 会場名の集合比較 */
  venues: VenueComparison[];
  /** 正解にあるのに抽出に無い会場 (= 欠落。最も重い) */
  missingVenues: string[];
  /** 抽出にあるのに正解に無い会場 (= 捏造の疑い) */
  fabricatedVenues: string[];
  /** 期間が食い違う会場 */
  periodMismatches: string[];
  /**
   * **正解データ側で期間を読めなかった**会場 (= 照合不能)。
   *
   * ⚠️ `periodMismatches` (不一致) と**別枠にする**。両者は原因も対処もまったく違う:
   *
   * - 不一致 = 抽出が間違っている → 再抽出する価値がある
   * - 未取得 = 測る側が読めていない → 再抽出しても直らない。profile か正規表現の問題
   *
   * 混ぜると「再抽出すれば直る」と誤認し、直らないものを何度も回すことになる。
   * **`passed` には含めない** — 測れなかったことを不合格にするのは
   * 「測れなかった ≠ 間違っていた」の違反。ただし黙らせず必ず表に出す。
   */
  unmeasuredPeriodVenues: string[];
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
 *
 * ⚠️ **副作用を持たない。** 以前は正解側の会場名重複を検知したときに `console.warn` して
 * いたが、本関数は実行ごとにループから呼ばれるため**同じ警告が実行回数ぶん重複**した。
 * 警告は `duplicateSourceVenues` を見て呼び出し側が 1 回だけ出す
 * (`warnOnceForSourceIssues`)。
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
      actualUniqueCount: new Set(
        occurrences
          .map((o) => o.venue_label)
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map(normalizeVenueKey)
      ).size,
      duplicateVenues: [],
      duplicateSourceVenues: [],
      missingVenueLabelCount: occurrences.filter(
        (o) => !o.venue_label || o.venue_label.trim().length === 0
      ).length,
      venues: [],
      missingVenues: [],
      fabricatedVenues: [],
      periodMismatches: [],
      unmeasuredPeriodVenues: [],
      // ★ 照合できないものを合格にしない。「測れなかった」と「正しかった」は別。
      passed: false,
      reason: truth.reason,
    };
  }

  // ★ `actual` 側と対称に扱う。正解データ側の衝突は「測る側が壊れている」状態で、
  //   黙って畳むと expectedCount が過少になり、抽出側の欠落を見逃す。
  const expected = new Map<string, SourceTruthVenue>();
  const duplicateSourceVenues: string[] = [];
  for (const v of truth.venues) {
    if (!v.venueLabel) continue;
    const key = normalizeVenueKey(v.venueLabel);
    if (expected.has(key)) {
      if (!duplicateSourceVenues.includes(v.venueLabel)) duplicateSourceVenues.push(v.venueLabel);
      continue;
    }
    expected.set(key, v);
  }

  // ★ Map への畳み込みで重複が silent に消える。消えた事実そのものが欠陥の signal
  //   (同じ会場を 2 回出している = 別の会場を 1 つ落としている) なので、捨てずに拾う。
  const actual = new Map<string, ExtractedOccurrence>();
  const duplicateVenues: string[] = [];
  let missingVenueLabelCount = 0;
  for (const o of occurrences) {
    // 会場名が空の occurrence は照合できない。**件数の食い違いの理由が「重複」と
    // 別なので、別に数える** (混ぜると表示が原因を誤らせる)。
    if (!o.venue_label || o.venue_label.trim().length === 0) {
      missingVenueLabelCount++;
      continue;
    }
    const key = normalizeVenueKey(o.venue_label);
    if (actual.has(key)) {
      if (!duplicateVenues.includes(o.venue_label)) duplicateVenues.push(o.venue_label);
      continue;
    }
    actual.set(key, o);
  }

  const venues: VenueComparison[] = [];
  const missingVenues: string[] = [];
  const fabricatedVenues: string[] = [];
  const periodMismatches: string[] = [];
  const unmeasuredPeriodVenues: string[] = [];

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

    const base = {
      venueLabel: source.venueLabel!,
      presence: 'both' as const,
      expected: { startsOn: source.startsOn, endsOn: source.endsOn },
      actual: { startsOn: found.starts_on ?? null, endsOn: found.ends_on ?? null },
    };

    // ★ 正解側が期間を読めていないなら、「不一致」ではなく「照合不能」。
    //   ここで比較すると、抽出が正しくても null !== '2026-05-14' で不一致になり、
    //   測る側の欠落を抽出側の誤りとして報告してしまう。
    //
    //   読めていない状態は 2 つある (2026-08-13 Step B-2 で後者を追加):
    //   - `startsOn === null`        … 開始日が読めなかった
    //   - `periodKind === 'unreadable'` … 終了日が**書いてあるのに**読めなかった
    //                                    (`◯月◯日より △月△日まで` 表記。詳細は `readPeriod`)
    //
    //   ⚠️ `open-ended` はここに入れない。「公式が終了日を書いていない」= それが事実で
    //      あり、抽出側が終了日を出してきたら**捏造として検出したい**ため比較へ回す。
    if (source.startsOn === null || source.periodKind === 'unreadable') {
      unmeasuredPeriodVenues.push(source.venueLabel!);
      venues.push(base);
      continue;
    }

    const periodMatches =
      source.startsOn === (found.starts_on ?? null) &&
      (source.endsOn ?? null) === (found.ends_on ?? null);
    if (!periodMatches) periodMismatches.push(source.venueLabel!);

    venues.push({ ...base, periodMatches });
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
  const actualUniqueCount = actual.size;

  return {
    status: 'supported',
    // 生の件数ではなく重複除去後で判定する。生の件数で見ると「渋谷店 × 2」が
    // 「正解 2 / 抽出 2」の一致に化ける (sw2026 run 10/11 で実際に起きた)。
    countMatches: expectedCount === actualUniqueCount,
    expectedCount,
    actualCount,
    actualUniqueCount,
    duplicateVenues,
    duplicateSourceVenues,
    missingVenueLabelCount,
    venues,
    missingVenues,
    fabricatedVenues,
    periodMismatches,
    unmeasuredPeriodVenues,
    // ★ `unmeasuredPeriodVenues` は含めない。測る側が読めなかっただけで、
    //   抽出結果が誤っている根拠にはならない (再抽出しても直らない)。
    passed:
      missingVenues.length === 0 &&
      fabricatedVenues.length === 0 &&
      periodMismatches.length === 0 &&
      duplicateVenues.length === 0,
  };
}

/**
 * 会場数の内訳を人が読む 1 行にする。
 *
 * ⚠️ `actualCount !== actualUniqueCount` を一律「重複除去後」と書いてはいけない。
 * 差の原因は **重複** と **会場名が空** の 2 つがあり、対処がまったく違う
 * (前者はプロンプトの出力規則、後者は抽出そのものの失敗)。理由を名指しする。
 *
 * @returns 内訳がなければ空文字列
 */
export function formatOccurrenceCountBreakdown(result: SourceComparison): string {
  const parts: string[] = [];
  if (result.duplicateVenues.length > 0) {
    parts.push(`重複 ${result.duplicateVenues.length} 会場`);
  }
  if (result.missingVenueLabelCount > 0) {
    parts.push(`会場名が空 ${result.missingVenueLabelCount} 件`);
  }
  if (parts.length === 0) return '';
  return ` (生 ${result.actualCount} 件 / ${parts.join(' + ')})`;
}

/**
 * 1 実行ぶんの照合結果を人が読む行の配列にする。
 *
 * ## なぜ両スクリプトで共有するか
 *
 * `compare-runs.ts` と `verify-against-source.ts` が同じ内訳 (重複 / 会場名が空 /
 * 正解側の重複 / 欠落 / 捏造 / 期間相違) をそれぞれ組み立てていた。フィールドを
 * 足したときに**片方だけ表示が更新されず、同じデータで違う結論に見える**。
 * 表示の同期をコードで保証する。
 *
 * @param result 照合結果
 * @param indent 各行の先頭に付ける空白 (スクリプトごとに階層が違うため)
 */
export function formatSourceComparisonLines(result: SourceComparison, indent = ''): string[] {
  const lines: string[] = [];

  lines.push(
    `${indent}会場数: 正解 ${result.expectedCount} / 抽出 ${result.actualUniqueCount}` +
      formatOccurrenceCountBreakdown(result) +
      (result.countMatches ? '' : '  ⚠️')
  );

  if (result.duplicateVenues.length > 0) {
    lines.push(`${indent}🔴 会場名の重複: ${result.duplicateVenues.join(', ')}`);
  }
  if (result.missingVenueLabelCount > 0) {
    lines.push(`${indent}🔴 会場名が空の occurrence: ${result.missingVenueLabelCount} 件`);
  }
  // ★ 正解側の重複は「測る側の問題」。抽出側の欠陥と混ぜて読ませない。
  if (result.duplicateSourceVenues.length > 0) {
    lines.push(
      `${indent}⚠️ 正解データ側の会場名重複: ${result.duplicateSourceVenues.join(', ')} (測る側の問題)`
    );
  }
  if (result.missingVenues.length > 0) {
    lines.push(`${indent}🔴 欠落: ${result.missingVenues.join(', ')}`);
  }
  if (result.fabricatedVenues.length > 0) {
    lines.push(`${indent}🔴 正解に無い会場 (捏造の疑い): ${result.fabricatedVenues.join(', ')}`);
  }
  if (result.periodMismatches.length > 0) {
    lines.push(`${indent}🟡 期間の不一致: ${result.periodMismatches.join(', ')}`);
  }
  // ★ 不一致の下に、別の記号・別の文言で置く。同じ 🟡 にすると読み手が
  //   「再抽出すれば直る」と誤認する (未取得は再抽出しても直らない)。
  if (result.unmeasuredPeriodVenues.length > 0) {
    lines.push(
      `${indent}⚠️ 正解側で期間を読めなかった会場: ${result.unmeasuredPeriodVenues.join(', ')}` +
        ' (測る側の問題 / 不一致ではない)'
    );
  }

  return lines;
}

/**
 * 正解データ側の問題を**一度だけ**警告する。
 *
 * `compareWithSource` は実行ごとにループから呼ばれるため、関数内で warn すると同じ
 * 警告が実行回数ぶん重複する。正解データは全実行で共通なので、警告も 1 回でよい。
 *
 * @param result いずれかの実行の照合結果 (正解側の情報は全実行で同じ)
 * @returns 警告を出したら true
 */
export function warnOnceForSourceIssues(result: SourceComparison): boolean {
  if (result.duplicateSourceVenues.length === 0) return false;

  console.warn(
    `[SourceTruth] ⚠️ 正解データ側で会場名が重複しています: ${result.duplicateSourceVenues.join(', ')}` +
      ` — expectedCount が過少になり、抽出側の欠落を見逃す可能性があります`
  );
  return true;
}
