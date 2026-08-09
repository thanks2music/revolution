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

import { validateVenueLabel } from './venue-label-validator';

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
  /** H2 の主語。各セクションはこれに「のメニュー」等を付ける */
  見出し主語: string;
  /** 呼び出し側がログへ出す。throw はしない (observability 規約) */
  warnings: string[];
}

/** 英数字だけを残して小文字化する。ドメインとブランド名/slug の突き合わせ用。 */
function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 都道府県名から接尾辞を落とす。
 *
 * ★ `道` は落とさない。「北海道」から落とすと「北海」という存在しない地名になる。
 */
function shortenPrefecture(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '北海道') return trimmed;
  return trimmed.replace(/[都府県]$/, '');
}

/**
 * 会場名の先頭に一致するブランドを辞書から引く。
 *
 * 最長一致を採る。「BOX cafe&space」と「BOX cafe&space 天王寺MIO店」のように
 * 辞書側に長短が混ざっても、より具体的な方を選ぶため。
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

/** Step 5 の都市表記を作る。件数が多いときは「N都市」に丸める。 */
function buildCityLabel(prefectures: string[]): string {
  const unique: string[] = [];
  for (const pref of prefectures) {
    const short = shortenPrefecture(pref);
    if (short.length === 0 || unique.includes(short)) continue;
    unique.push(short);
  }
  if (unique.length === 0) return '';
  if (unique.length > CITY_LIST_MAX) return `${unique.length}都市`;
  return unique.join(CITY_JOIN);
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

  const base = {
    会場数: 会場一覧.length,
    is_multi_venue: 会場一覧.length >= 2,
    会場一覧,
    会場一覧表記: 会場一覧.join(VENUE_JOIN),
    ブランド一覧,
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
    warnings,
  });

  // --- Step 2: 会場が 1 つ → 支店名まで出す ---
  if (会場一覧.length === 1) {
    return asVenue(会場一覧[0] ?? '');
  }

  // --- Step 3: ブランドが 1 つ → そのブランド名 ---
  if (ブランド一覧.length === 1 && 辞書に無い会場 === 0) {
    return asVenue(ブランド一覧[0] ?? '');
  }

  // --- Step 4: ブランドが複数 → ドメインで「集合の中から」選ぶ ---
  if (ブランド一覧.length >= 2 && input.officialUrl) {
    const picked = pickBrandByDomain(input.officialUrl, ブランド一覧, brandSlugs);
    if (picked !== null) return asVenue(picked);
    warnings.push(
      `ブランドが ${ブランド一覧.length} 種類ありますが、公式サイトのドメインがどれとも一致しませんでした。` +
        `都市名での見出しに切り替えます（会場でないものを代表にしないため）。`
    );
  }

  // --- Step 5: 都市名の見出しへ ---
  const 都市表記 = buildCityLabel(input.prefectures ?? []);
  const 種別 = (input.eventTypeLabel ?? '').trim();

  if (都市表記.length === 0) {
    // 都道府県も取れない。作品名だけに退避する（throw しない = observability 規約）。
    warnings.push(
      '代表会場名を決められず、都道府県も取得できませんでした。見出しを作品名のみに退避します。'
    );
    return { ...base, 見出し形式: 'cities', 代表店舗名: '', 都市表記: '', 見出し主語: workTitle, warnings };
  }

  if (種別.length === 0) {
    // 種別なしで「in 東京・大阪」だけにすると、3-title.yaml が禁じる
    // 「× 都市名のみ」と同じ問題（何のイベントか分からない）になる。
    warnings.push(
      'イベント種別の表記が渡されなかったため、見出しに種別を含められませんでした。' +
        'event-type-slugs.yaml 由来の表記を渡してください。'
    );
  }

  const 見出し主語 = [workTitle, 種別].filter((s) => s.length > 0).join(' ') + ` in ${都市表記}`;

  return {
    ...base,
    見出し形式: 'cities',
    代表店舗名: '',
    都市表記,
    見出し主語: 見出し主語.trim(),
    warnings,
  };
}
