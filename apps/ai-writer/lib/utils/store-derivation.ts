/**
 * Store Derivation Utility
 *
 * @description
 * `occurrences[]` から会場まわりの**派生変数**を導出する純粋関数。
 * 中核は「本文の見出しに出す代表会場をどう決めるか」の**5 段決定表**である。
 *
 * ## なぜ必要か (非対称の解消)
 *
 * `lead-generator.service.ts` の `computeEnrichedData` と
 * `text-placeholder-replacer.service.ts` の `computeDerivedVariables` は、
 * **works 系だけ**派生変数を持っている (`primary_work` / `secondary_works` /
 * `is_multi_work` / `コラボ作品名`)。一方 **store 系は `店舗名` を素通しするだけ**で、
 * 「代表会場はどれか」「何会場あるか」を表す変数が存在しない。
 *
 * その結果、LLM が「、」で連結した会場名がそのままリード文と H2 見出しに流れ込んでいた。
 *
 * ```
 * ## トイ・ストーリー5 × OH MY CAFE 表参道ヒルズ、BOX cafe&space ルミネエスト新宿2号店、… のメニュー
 * ```
 *
 * ## 代表会場名の決定表 (2026-08-09 BOSS 確定)
 *
 * ```
 * 1. venue_label の先頭を brand-slugs.yaml と照合し、ブランド集合を作る
 * 2. 会場が 1 つ        → venue_label をそのまま (支店名まで出す)
 * 3. ブランドが 1 つ    → そのブランド名
 * 4. ブランドが複数     → 公式サイトのドメインを見て「集合の中から」主催を選ぶ
 * 5. 4 で決まらない     → {作品名} {種別} in {都道府県・都道府県}
 * ```
 *
 * **全段 rule-driven で、LLM に代表を選ばせない。** 決定的に決まるので LLM の判断を
 * 挟む余地がなく、挟むと Phase 2 で潰した連結が再流入する経路を残すことになる
 * (`store.name` は連結を出していた当のフィールド)。
 *
 * ### Step 4 を「集合の中から選ぶ」に制約する理由
 *
 * ドメイン由来のブランドを自由に採用せず、**`occurrences[]` に実在するブランドに限定**する。
 * D.Gray-man の公式サイトは `medicos-e.net` (メディコス = 企業) だが、会場は
 * キャラウムカフェ / CAFE EPIC TALE の 2 ブランドである。制約がないと**会場ですらない
 * 企業名が H2 見出しに出る**。`store-name-validator.ts` は法人格 (`CO.,LTD` / `株式会社` /
 * `製作委員会` / `©`) の有無で判定するため、`MEDICOS` 単体を弾けない。
 *
 * ### Step 5 は例外ルールではない
 *
 * `pipeline/3-title.yaml` v2.3.1 が既に同じ形を持つ
 * (「× {{施設名}}」→「カフェ in {{都市名}}」/「× 都市名のみ」は絶対禁止)。
 * 本番記事にも `D.Gray-man カフェ in 東京/大阪 7月15日よりコラボ開催` が実在する。
 * **本文をタイトルの既存ルールに揃えるだけ**で、新しい概念を持ち込まない。
 *
 * 区切りはタイトルが `/`、本文が `・`。タイトルは 42 文字制限があり短い記号が有利で、
 * 本文にその制約はないため**用途の違いによる意図的な不統一** (BOSS 確定)。
 *
 * ## 見出しの主語をここで確定させる
 *
 * Step 5 は代表会場名を差し替えるのではなく、**見出しの形そのものを変える**
 * (`{作品名} × {店舗名}` → `{作品名} {種別} in {都市}`)。よって「会場名」だけを
 * 返しても表現できない。`見出し主語` として**組み立て済みの文字列**を返し、
 * 各セクションはそれに「のメニュー」等を付けるだけにする。
 *
 * H2 は `content-generation.service.ts` の指示で LLM が書くため、**組み立てを
 * LLM に任せると連結が再発しうる**。確定文字列を渡して「そのまま使う」と指示する。
 *
 * @module lib/utils/store-derivation
 * @see lib/utils/occurrence-normalizer.ts (本モジュールの前段。連結の分割を担う)
 * @see lib/config/slug-resolver.ts (`getAllBrandNames()` / `BRAND_SLUGS` の既存ローダー)
 * @see lib/services/lead-generator.service.ts (works 系派生の既存実装。対称性の参照元)
 */

import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';

import { shortenPrefecture, validateVenueLabel } from './venue-label-validator';

/** 表示用に会場名を連結する際の区切り。キャラクター名と同じく読点 (Templates CLAUDE.md §6.1)。 */
const VENUE_JOIN = '、';

/**
 * 都市名を連結する際の区切り。
 *
 * ★ 中黒。キャラクター名の「、」とは別系統で、**地名列挙の「・」は §6.1 のスコープ外**
 *   として既に許容されている。タイトル側は文字数制限のため `/` を使うが、本文に
 *   その制約はないため用途に応じて分ける (BOSS 確定 2026-08-09)。
 */
const CITY_JOIN = '・';

/**
 * 都市名を列挙せず「N都市」に丸める閾値。
 *
 * ★ 名探偵コナンカフェの実例は 8 会場。都道府県が 6 つあると
 *   `in 東京・宮城・愛知・大阪・福岡・北海道` となり見出しとして破綻する。
 *   タイトル側が既に `in 5都市` の丸め形を持つため、それに揃える。
 */
const CITY_LIST_MAX = 4;

/**
 * タイトル用に都市を列挙する上限。本文より **1 件厳しい**。
 *
 * ★ 記事タイトルは 28〜40 文字の制約があり、本文にはこの制約がない。
 *   4 都道府県を列挙すると `東京/愛知/大阪/宮城` で 11 文字を占め、
 *   実測 (トイ・ストーリー5) で上限ちょうど 40 文字に達した。
 *   作品名が 1 文字伸びるだけで超過するため、タイトル側は 3 件で丸める。
 */
const CITY_LIST_MAX_TITLE = 3;

/**
 * タイトルで都市を連結する際の区切り。
 *
 * ★ 本文は `・`、タイトルは `/`。タイトルは文字数制約が厳しく短い記号が有利で、
 *   本文にその制約はないため**用途の違いによる意図的な不統一** (BOSS 確定 2026-08-09)。
 *   本番記事のタイトルにも `D.Gray-man カフェ in 東京/大阪` が実在する。
 */
const CITY_JOIN_TITLE = '/';

/**
 * ドメイン照合に使うトークンの最小長。
 *
 * ★ 短いトークンはホスト名の一部と偶然一致しうる。ブランド集合への限定と併せた
 *   二重の歯止め。
 */
const MIN_DOMAIN_TOKEN_LENGTH = 4;

export interface DeriveStoreContextInput {
  /** 正規化済みの `occurrences[]`。`normalizeOccurrences` の出力を渡す */
  occurrences?: EventDataOccurrence[] | null;
  /**
   * 公式サイト URL。Step 4 のドメイン照合に使う。
   * 抽出結果の `公式サイトURL` (`extraction-response.ts`) を渡す。
   */
  officialUrl?: string | null;
  /**
   * ブランド辞書 (ブランド名 → slug)。Templates の `brand-slugs.yaml` 由来。
   * 呼び出し側が `loadYamlConfig('BRAND_SLUGS').brand_slugs` を渡す
   * (本モジュールを純粋関数に保つため、ここでは読み込まない)。
   */
  brandSlugs?: Record<string, string> | null;
  /** frontmatter の `prefectures`。Step 5 の都市表記に使う */
  prefectures?: string[] | null;
  /**
   * イベント種別の日本語表記 (例: 「カフェ」)。Step 5 で使う。
   *
   * ★ **「カフェ」をハードコードしてはならない。** `event_type` は `collabo-cafe` 等の
   *   slug で、pop-up-store / 原画展に「カフェ」と書くと事実誤認になる
   *   (`revolution-article-meta.md` §4.3 と同趣旨)。`event-type-slugs.yaml` 由来の
   *   表記を渡すこと。
   */
  eventTypeLabel?: string | null;
  /** 作品名。Step 5 の見出し主語に使う */
  workTitle?: string | null;
}

/** 見出しをどの形で組み立てたか。Step 2-4 = `venue` / Step 5 = `cities`。 */
export type VenueHeadingKind = 'venue' | 'cities';

export interface StoreContext {
  /** ユニークな会場の数 (同一会場の複数期間は 1 と数える) */
  会場数: number;
  /** 2 会場以上か。`is_multi_work` と対称 */
  is_multi_venue: boolean;
  /** ユニークな会場名の配列 (出現順) */
  会場一覧: string[];
  /** 表示用の連結。会場がなければ空文字 */
  会場一覧表記: string;
  /** 決定表で選ばれたブランド (出現順、重複なし)。判定の可視化用 */
  ブランド一覧: string[];
  /** 見出しをどの形で組み立てたか */
  見出し形式: VenueHeadingKind;
  /** Step 2-4 の結果。Step 5 (`cities`) のときは空文字 */
  代表店舗名: string;
  /** Step 5 の都市表記 (`東京・大阪` / `5都市`)。それ以外は空文字 */
  都市表記: string;
  /**
   * **記事タイトル用**の都市表記 (`東京/大阪` / `4都市`)。
   *
   * @description
   * 本文用 (`都市表記`) とは区切りも丸め閾値も異なる。タイトルは 28〜40 文字の
   * 制約があり、本文にはこの制約がない。
   *
   * ★ **見出しと記事タイトルは同じ情報源から作る。** 従来タイトルは構造化データを
   *   受け取っておらず、LLM が本文 3000 字から都市を読み取っていたため、
   *   実測 4 件で「東京・大阪の 2 会場開催なのにタイトルは `in 渋谷`」のように
   *   開催地が欠落していた (2026-08-09)。
   *
   * ★ 会場が特定できる場合 (`venue` 形式) でも**空にしない**。タイトルは
   *   会場名ではなく都市名を使う設計 (`3-title.yaml` の短縮ラダー) のため、
   *   H2 が会場名になるケースでもタイトルには都市が要る。
   */
  都市表記タイトル用: string;
  /** H2 の主語。各セクションはこれに「のメニュー」等を付ける */
  見出し主語: string;
  /**
   * 地の文で会場を指すときの表記。`{{店舗名}}` へ流し込む値。
   *
   * @description
   * 見出しは名詞句、リード文は文である。同じ文字列は使えない
   * (`× カフェ in 東京・大阪にてコラボカフェが開催される` は冗長で不自然)。
   * よって見出しとは別に、文に埋めても自然な表記を用意する。
   *
   * ★ **これが無いと見出しとリード文で会場の表現が食い違う。** 実測では
   *   見出しが「カフェ in 東京・大阪」なのにリード文は東京の 1 店だけを名指しし、
   *   大阪の会場が本文から消えていた (claude[bot] 指摘、2026-08-09)。
   *
   * - 会場が特定できる場合: 代表店舗名 (例: `BOX cafe&space`)
   * - 多ブランドで代表が決まらない場合: `東京・大阪の各会場` / `5都市の各会場`
   */
  会場表現: string;
  /** 呼び出し側がログへ出す。throw はしない (observability 規約) */
  warnings: string[];
}

/** 英数字だけを残して小文字化する。ドメインとブランド名/slug の突き合わせ用。 */
function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 会場名の先頭に一致するブランドを辞書から引く。
 *
 * 最長一致を採る。「BOX cafe&space」と「BOX cafe&space 天王寺MIO店」のように
 * 辞書側に長短が混ざっても、より具体的な方を選ぶため。
 *
 * ★ **同じ長さのブランド名が複数一致した場合は、辞書 (YAML) の記述順で先に来た方**を採る
 *   (`>` の厳密比較のため後続では上書きされない)。決定的ではあるが、暗黙に YAML の
 *   記述順へ依存している。同名同長のブランドを辞書へ足す際は順序に注意すること。
 */
function matchBrand(venueLabel: string, brandNames: string[]): string | null {
  let best: string | null = null;
  for (const name of brandNames) {
    if (!venueLabel.startsWith(name)) continue;
    if (best === null || name.length > best.length) best = name;
  }
  return best;
}

/**
 * 公式サイトのドメインから、**候補集合に含まれる**ブランドを 1 つ選ぶ。
 *
 * @description
 * ブランド名と slug の両方を正規化してホスト名に含まれるか調べる
 * (辞書の slug は `oh-my-cafe`、ドメインは `ohmycafe` でハイフンの有無が違う)。
 * 日本語ブランド名は正規化すると空になるため slug 側だけが効く。
 *
 * 複数一致したら**一致トークンが最も長いもの**を採る。
 */
function pickBrandByDomain(
  officialUrl: string,
  candidates: string[],
  brandSlugs: Record<string, string>
): string | null {
  let host: string;
  try {
    host = new URL(officialUrl).hostname;
  } catch {
    return null;
  }
  const normalizedHost = normalizeToken(host);
  if (normalizedHost.length === 0) return null;

  let best: { brand: string; length: number } | null = null;
  for (const brand of candidates) {
    const tokens = [normalizeToken(brand), normalizeToken(brandSlugs[brand] ?? '')];
    for (const token of tokens) {
      if (token.length < MIN_DOMAIN_TOKEN_LENGTH) continue;
      if (!normalizedHost.includes(token)) continue;
      if (best === null || token.length > best.length) {
        best = { brand, length: token.length };
      }
    }
  }
  return best?.brand ?? null;
}

/** 都道府県名を短縮し、重複を畳んで出現順に並べる。 */
function toUniqueCities(prefectures: string[]): string[] {
  const unique: string[] = [];
  for (const pref of prefectures) {
    const short = shortenPrefecture(pref);
    if (short.length === 0 || unique.includes(short)) continue;
    unique.push(short);
  }
  return unique;
}

/**
 * 都市表記を作る。件数が上限を超えたら「N都市」に丸める。
 *
 * 区切りと上限を引数に取るのは、**本文とタイトルで要件が違う**ため
 * (本文 = `・` / 4 件まで、タイトル = `/` / 3 件まで)。
 * 丸めの判定ロジックを 2 箇所に書かないための共通化。
 */
function buildCityLabel(cities: string[], separator: string, max: number): string {
  if (cities.length === 0) return '';
  if (cities.length > max) return `${cities.length}都市`;
  return cities.join(separator);
}

/**
 * `occurrences[]` から会場の派生変数を導出する。
 *
 * 純粋関数。入力は変更しない。辞書・設定の読み込みは呼び出し側の責務。
 *
 * @example
 * // Step 4: 3 ブランド + ドメインが OH MY CAFE を示す
 * deriveStoreContext({
 *   occurrences: [
 *     { venue_label: 'OH MY CAFE 表参道ヒルズ', ... },
 *     { venue_label: 'BOX cafe&space ルミネエスト新宿2号店', ... },
 *     { venue_label: 'BALLER:S イオンモール新利府店', ... },
 *   ],
 *   officialUrl: 'https://toy5-ohmycafe.ltr-online.com',
 *   brandSlugs: { 'OH MY CAFE': 'oh-my-cafe', ... },
 *   workTitle: 'トイ・ストーリー5',
 * })
 * // → 代表店舗名: 'OH MY CAFE'（最多の BOX cafe&space ではない）
 */
export function deriveStoreContext(input: DeriveStoreContextInput): StoreContext {
  const warnings: string[] = [];
  const occurrences = input.occurrences ?? [];
  const brandSlugs = input.brandSlugs ?? {};
  const brandNames = Object.keys(brandSlugs);
  const workTitle = (input.workTitle ?? '').trim();

  // --- 会場の一意化。同一会場の前期/後期は 1 会場として畳む。出現順は保つ ---
  //
  // ★ 会場でないものはここで除外する (2026-08-09 BOSS 確定)。実測で `ONLINE販売`
  //   (販売チャネル) や `東京` (都道府県) が会場として抽出され、そのままだと
  //   `## 名探偵コナン × ONLINE販売のメニュー` という見出しになっていた。
  //
  // ★ **`occurrences[]` からは消さない。** 抽出できた事実は残し、DB 取り込み (S3)
  //   の判断に委ねる。「見出しに出さないこと」と「データとして持たないこと」は別問題。
  const 会場一覧: string[] = [];
  const seenVenue = new Set<string>();
  for (const occ of occurrences) {
    const label = occ.venue_label;
    if (typeof label !== 'string' || label.length === 0) continue;
    if (seenVenue.has(label)) continue;
    seenVenue.add(label);

    const invalidReason = validateVenueLabel(label, input.prefectures);
    if (invalidReason !== null) {
      warnings.push(`会場として扱えない値を見出しの導出から除外しました: ${invalidReason}`);
      continue;
    }
    会場一覧.push(label);
  }

  // --- Step 1: ブランド集合 ---
  const ブランド一覧: string[] = [];
  let 辞書に無い会場 = 0;
  for (const label of 会場一覧) {
    const brand = matchBrand(label, brandNames);
    if (brand === null) {
      辞書に無い会場 += 1;
      continue;
    }
    if (!ブランド一覧.includes(brand)) ブランド一覧.push(brand);
  }
  if (辞書に無い会場 > 0) {
    warnings.push(
      `ブランド辞書に一致しない会場が ${辞書に無い会場} 件あります。` +
        `brand-slugs.yaml への追補が必要な可能性があります（ブランド数の判定が狂うと代表会場名を誤ります）。`
    );
  }

  // ★ 都市は**どの経路でも**必要になる。H2 が会場名になる場合 (Step 2-4) でも、
  //   記事タイトルは都市名を使う設計 (`3-title.yaml` の短縮ラダー) のため。
  //   従来タイトルは構造化データを受け取っておらず、LLM が本文 3000 字から
  //   読み取って開催地を落としていた (実測 4 件、2026-08-09)。
  const 都市一覧 = toUniqueCities(input.prefectures ?? []);

  const base = {
    会場数: 会場一覧.length,
    is_multi_venue: 会場一覧.length >= 2,
    会場一覧,
    会場一覧表記: 会場一覧.join(VENUE_JOIN),
    ブランド一覧,
    都市表記タイトル用: buildCityLabel(都市一覧, CITY_JOIN_TITLE, CITY_LIST_MAX_TITLE),
  };

  /** Step 2-4 の共通の締め。見出し主語を組み立てて返す。 */
  const asVenue = (代表店舗名: string): StoreContext => ({
    ...base,
    見出し形式: 'venue',
    代表店舗名,
    都市表記: '',
    見出し主語:
      workTitle.length > 0 && 代表店舗名.length > 0
        ? `${workTitle} × ${代表店舗名}`
        : workTitle || 代表店舗名,
    // 地の文でもそのまま使える (「× BOX cafe&spaceにて開催される」)
    会場表現: 代表店舗名,
    warnings,
  });

  // --- Step 2: 会場が 1 つ → 支店名まで出す ---
  if (会場一覧.length === 1) {
    return asVenue(会場一覧[0] ?? '');
  }

  // --- Step 3: ブランドが 1 つ → そのブランド名 ---
  //
  // ★ `辞書に無い会場 === 0` を条件に含めるため、「辞書に一致するブランドが 1 種類 +
  //   辞書未登録の会場が 1 件」は **Step 3 にも Step 4 にも該当せず Step 5 (都市名) へ落ちる**。
  //   これは意図的で、そのブランド名を代表にすると**未登録の会場を切り捨てた**ことになるため。
  //   例: [BOX cafe&space 東京ソラマチ店, コーチャンフォー新川通り店] で
  //       「BOX cafe&space」を代表にすると、もう 1 会場が本文から消える。
  //   辞書の追補で解消すべき状態なので warn を出している (上の「ブランド辞書に一致しない会場」)。
  if (ブランド一覧.length === 1 && 辞書に無い会場 === 0) {
    return asVenue(ブランド一覧[0] ?? '');
  }

  // --- Step 4: ブランドが複数 → ドメインで「集合の中から」選ぶ ---
  if (ブランド一覧.length >= 2) {
    // ★ 公式 URL 未指定と、URL はあるが一致しないのは**同じ種類の情報**
    //   (どちらも「なぜ代表会場名を選べなかったか」) なので、両方 warn する。
    //   片方だけ黙って落とすと dry-run ログから経緯が追えなくなる。
    if (!input.officialUrl) {
      warnings.push(
        `ブランドが ${ブランド一覧.length} 種類ありますが、公式サイトの URL が渡されていないため` +
          `主催ブランドを判定できませんでした。都市名での見出しに切り替えます。`
      );
    } else {
      const picked = pickBrandByDomain(input.officialUrl, ブランド一覧, brandSlugs);
      if (picked !== null) return asVenue(picked);
      warnings.push(
        `ブランドが ${ブランド一覧.length} 種類ありますが、公式サイトのドメインがどれとも一致しませんでした。` +
          `都市名での見出しに切り替えます（会場でないものを代表にしないため）。`
      );
    }
  }

  // --- Step 5: 都市名の見出しへ ---
  const 都市表記 = buildCityLabel(都市一覧, CITY_JOIN, CITY_LIST_MAX);
  const 種別 = (input.eventTypeLabel ?? '').trim();

  if (都市表記.length === 0) {
    // 都道府県も取れない。作品名だけに退避する（throw しない = observability 規約）。
    warnings.push(
      '代表会場名を決められず、都道府県も取得できませんでした。見出しを作品名のみに退避します。'
    );
    return {
      ...base,
      見出し形式: 'cities',
      代表店舗名: '',
      都市表記: '',
      見出し主語: workTitle,
      // 会場を指す言葉が何も作れない。呼び出し側が抽出結果の店舗名へ退避する。
      会場表現: '',
      warnings,
    };
  }

  if (種別.length === 0) {
    // 種別なしで「in 東京・大阪」だけにすると、3-title.yaml が禁じる
    // 「× 都市名のみ」と同じ問題（何のイベントか分からない）になる。
    warnings.push(
      'イベント種別の表記が渡されなかったため、見出しに種別を含められませんでした。' +
        'event-type-slugs.yaml 由来の表記を渡してください。'
    );
  }

  // ★ 作品名が空だと ` in 東京` → trim して `in 東京` という**主語のない見出し**になる。
  //   都市表記も空のときは退避しているのに、こちらだけガードが無かった
  //   (claude[bot] 指摘、2026-08-09)。同じ扱いに揃える。
  if (workTitle.length === 0) {
    warnings.push(
      '作品名が空のため、都市名だけの見出しになるのを避けて見出し主語を空にしました。' +
        '呼び出し側でセクション側の既定文言へ退避してください。'
    );
    return {
      ...base,
      見出し形式: 'cities',
      代表店舗名: '',
      都市表記,
      見出し主語: '',
      会場表現: `${都市表記}の各会場`,
      warnings,
    };
  }

  const 見出し主語 = [workTitle, 種別].filter((s) => s.length > 0).join(' ') + ` in ${都市表記}`;

  return {
    ...base,
    見出し形式: 'cities',
    代表店舗名: '',
    都市表記,
    見出し主語: 見出し主語.trim(),
    // 見出しは名詞句、地の文は文。同じ文字列は使えないため別に組む
    // (`× カフェ in 東京・大阪にてコラボカフェが開催される` は冗長で不自然)。
    会場表現: `${都市表記}の各会場`,
    warnings,
  };
}
