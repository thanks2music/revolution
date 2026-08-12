/**
 * LLM へ渡す HTML を、情報を保全したまま圧縮する。
 *
 * ## なぜ必要か
 *
 * `extraction.service.ts` はページ本文を **`LLM_INPUT_BUDGET_CHARS` 文字でハード切り詰め**して
 * プロンプトに埋める。この上限は「マークアップ込みの文字数」で数えるのに、
 * `extractContentHtml` が返すのは**マークアップが 90% を超える生 HTML** である。
 * 結果、実テキストが 1,000 文字に満たないうちに窓を使い切る。
 *
 * `conan-cafe.jp` (名探偵コナンカフェ 2026) での実測 (2026-08-12):
 *
 * | 指標 | 値 |
 * |---|---|
 * | `extractContentHtml` の返り値 | 35,344 chars |
 * | うち実テキスト | 2,207 chars (**密度 6.2%**) |
 * | 当時の窓 (15,000) に入った実テキスト | **857 chars** |
 *
 * 公式トップには **8 会場が会場ごとに異なる期間つきで明記**されており
 * (東京だけで渋谷/池袋/ソラマチ/原宿の 4 会場)、**会場一覧は返り値には含まれていた**。
 * それでも窓の後半に位置していたため LLM へ届かず、抽出は要約文
 * 「6 都市 8 会場」から都市名だけを拾い、見えた唯一の日付を全会場に複写した
 * (`venue_label: "東京会場"` / `starts_on` が全件同一)。**事実誤認の生産**である。
 *
 * ## なぜ「上限を上げる」ではなく「圧縮する」のか
 *
 * 上限を上げてもマークアップ比率は変わらないため、**同じ密度のゴミをより多く送る**
 * だけになる。トークンコストも比例して増える。本モジュールは密度を上げることで、
 * **同じ窓に桁違いに多い情報を入れる**。実測 35,344 → 6,786 chars
 * (密度 6.2% → 35.8%) で、切り詰め自体が発生しなくなった。
 *
 * ## 最も効くのは「単一子ラッパーの unwrap」
 *
 * 段階ごとの実測 (conan-cafe.jp):
 *
 * | 段階 | サイズ | 密度 |
 * |---|---|---|
 * | 現状 | 35,344 | 6.2% |
 * | + `script`/`style`/`svg`/コメント削除 | 32,396 | 6.4% |
 * | + 属性除去 | 25,656 | 8.1% |
 * | + `img` を `alt` テキストへ | 25,518 | 9.5% |
 * | + 空要素削除 | 25,381 | 9.6% |
 * | **+ 単一子 `div`/`span` の unwrap** | **6,786** | **35.8%** |
 *
 * CMS が生成する深いラッパー `div` が支配的で、属性除去より桁で効く。
 *
 * ## 何を保持するか (情報保全の境界)
 *
 * - **`href` は保持する**。会場一覧が `/information/<地名>` へのリンク集で
 *   表現されるサイトがあり (`conan-cafe.jp` / `jujutsukaisen-cafe.jp` /
 *   `seventeen17-cafe.jp` で実測)、落とすと会場の存在自体が消える
 * - **`alt` は保持し、`img` は `[画像: <alt>]` へ畳む**。alt に会場名や
 *   メニュー名が入るため、要素ごと消すと情報が減る
 * - **`table` / `br` / `hr` は空要素判定から除外する**。会場別期間は表で
 *   表現されることが多く、セル構造を失うと会場と期間の対応が壊れる
 * - **属性を持つ要素は unwrap しない**。`id` 等が意味を持つ場合に備える
 *
 * @module lib/utils/compact-html
 */

import * as cheerio from 'cheerio';

/**
 * 実測した「文字数 → トークン数」の換算比。
 *
 * 観測ログ 18 本 (`logs/*-03-detail-extraction` の `promptChars` / `promptTokens`) の
 * 実測で **1.88〜2.15、平均 1.96**。日本語テキスト (1 文字 ≒ 1 token) と ASCII の
 * タグ・URL (4 文字 ≒ 1 token) が混ざって約 2 に収束する。
 *
 * 予算をトークンで語るための概算にのみ使う。課金や打ち切り判定には使わない。
 *
 * ⚠️ **ランタイムでは参照されない。** 本定数と `NON_CONTENT_TOKENS_ESTIMATE` /
 * `SMALLEST_CONTEXT_WINDOW_TOKENS` は、`LLM_INPUT_BUDGET_CHARS` の**導出前提を
 * コードとして表現し、テストで強制する**ためだけに export している。値を変えても
 * 実行時の挙動は一切変わらず、変わるのは「前提が崩れたらテストが落ちる」境界だけ。
 * docstring に書くだけでは陳腐化を検出できないため、あえて公開面に出している。
 */
export const CHARS_PER_TOKEN_ESTIMATE = 1.96;

/**
 * 同じ実測レンジの**最小値** (1.88)。
 *
 * chars/token が小さいほど**同じ文字数でより多くのトークンを消費する**ため、
 * 予算が窓に収まるかを検証する制約テストにはこちら (観測上の最悪値) を使う。
 * 平均 (`CHARS_PER_TOKEN_ESTIMATE`) を使うと、実際には超えるケースを通してしまう。
 *
 * ⚠️ **理論的な下限ではなく「観測範囲での最悪値」**。ASCII 比率がさらに低い
 * (= 日本語だけの) ページが来れば 1.88 を下回りうる。ただし本定数の用途は
 * 29〜30% 程度の使用率で余裕を確認することなので、精度は問題にならない。
 */
export const CHARS_PER_TOKEN_WORST_CASE = 1.88;

/**
 * `detail-extraction` のプロンプトへ埋め込めるページ本文の上限 (文字)。
 *
 * `extraction.service.ts` がこの値で `substring` するため、超えた分は **LLM へ届かない**。
 * 圧縮側 (`html-extractor.ts`) が「窓に収まるか」を警告するのにも同じ値を使う。
 *
 * ⚠️ **マジックナンバーとして 2 箇所に散らさない。** 切り詰める側と警告する側で値が
 * ずれると「警告は出ないのに切り捨てられている」状態になり、`conan-cafe.jp` で
 * 起きた沈黙 (会場一覧が届かず都市単位に畳まれる) を再生産する。
 *
 * ---
 *
 * ## この値の導出 (2026-08-12 改定: 15,000 → 60,000)
 *
 * ### 旧値 15,000 に根拠はなかった
 *
 * `git log -S "15000"` で追うと **2025-12-08 の `19a75ef`** (`ExtractionService` 新規
 * 作成) から一度も変わっておらず、**根拠を示すコメントが存在しなかった**。現行の
 * 既定モデル `gpt-5.4-mini` の採用 (2026-07-11, PR #243) より **7 ヶ月前**の値である。
 *
 * ### 制約は「最小のコンテキスト窓」で決まる
 *
 * `extraction.service.ts` は `AiProvider.sendMessage` 経由の **provider 非依存**な
 * 実装なので、設定された provider のどれでも安全でなければならない。
 *
 * | provider | 実使用モデル | コンテキスト窓 | 出典 |
 * |---|---|---|---|
 * | OpenAI (既定) | `gpt-5.4-mini` | 400,000 (GPT-5 mini 系) | https://developers.openai.com/api/docs/models/gpt-5-mini |
 * | Anthropic | `claude-sonnet-4-5-20250929` | **200,000** ← 最小 | https://platform.claude.com/docs/en/build-with-claude/context-windows |
 * | Google | `gemini-2.5-flash-lite` | 1,048,576 (2.5 Flash 系) | https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-preview-09-2025 |
 *
 * ⚠️ **未確認の点**: `gpt-5.4-mini` / `gemini-2.5-flash-lite` の専用ページは見つからず、
 * それぞれ `gpt-5-mini` (400k) / `gemini-2.5-flash-preview` (1,048,576) からの推定。
 * OpenAI は Amazon Bedrock 経由だと GPT-5.4/5.5/5.6 が 272,000 に制限される
 * (https://developers.openai.com/api/docs/guides/amazon-bedrock)。**確実なのは
 * Anthropic Sonnet 4.5 の 200,000 のみ**で、本定数はこれを binding constraint とする。
 *
 * ### 内訳 (実測ベース)
 *
 * | 要素 | tokens | 根拠 |
 * |---|---|---|
 * | Sonnet 4.5 のコンテキスト窓 | 200,000 | 公式 |
 * | − プロンプトのテンプレート部 (Few-shot 等) | −25,125 | **実測 21 本の最大値** (最小 20,921 / 平均 23,967) |
 * | − 出力 (`extraction.service.ts` の `maxTokens`) | −4,000 | 実装値 |
 * | = 本文に使える理論上の余地 | 172,000 (≒ 337,000 文字) | |
 * | **本定数** | **30,600 (60,000 文字) = 本文だけで窓の 15.3%** | |
 * | (参考) テンプレ・出力を含めた総使用率 | **30.5%** (最悪ケース。テストが強制する会計) | |
 *
 * ### なぜ理論上限まで上げないか
 *
 * 1. **`conan-cafe.jp` の圧縮前 35,344 文字を包含する**。圧縮が将来退行しても会場一覧は届く
 * 2. 総プロンプトが **最悪ケースでも ≒ 61,000 tokens = Sonnet 4.5 の 30.5%** に収まり、
 *    3 provider すべてで余裕がある。会計は本文 (60,000 / `CHARS_PER_TOKEN_WORST_CASE`
 *    = 31,915) + `NON_CONTENT_TOKENS_ESTIMATE` (29,125 = テンプレ 25,125 + 出力 4,000)。
 *    **観測平均ではなく観測最大・最小の悪い側を使う** (テンプレは実測最大、
 *    chars/token は実測最小 = 同じ文字数でより多くのトークンを消費する側)。
 *    テストが強制する会計と一致させてある
 * 3. **希釈リスクを測定していない**。入力を増やすと抽出精度が落ちるかは未検証なので、
 *    根拠なく大きく振らない
 *
 * ### ⚠️ これは品質レバーではなく「安全網」である
 *
 * 実測は「量」ではなく「**必要な情報が入っているか**」が効くことを示している。
 *
 * | 実行 | 実テキスト | 結果 |
 * |---|---|---|
 * | sw2026 改修前 | 4,346 文字 | ❌ 不正解 (大阪が入力に無い) |
 * | sw2026 改修後 | **862 文字** | ✅ 正解 |
 * | conan 改修後 | 2,399 文字 | ✅ 10/10 正解 |
 *
 * **上限を上げても、`selectMainContent` が拾わなかった情報は増えない。** 本定数を
 * 上げる目的は、圧縮 (`compactHtmlForLlm`) で収まらない重いページが来たときに
 * **静かに情報を失わない**ことだけである。
 *
 * ### コストへの影響 — **観測済みのページに限れば**ゼロ
 *
 * 圧縮後の実測は conan 6,653 / sw2026 2,939 / kusuriya 2,440 / bluelock 2,103 文字で
 * **すべて旧上限 15,000 未満**。引き上げ前後で `promptSha256` が一致することも確認済みで、
 * これらのページでは送信量が変わらない。
 *
 * ⚠️ **ただしこれは「上限が効かなかったページ」の観測でしかない。** 本改定が実際に効く
 * 対象 (圧縮しても予算を超えるページ) では、最悪ケースの入力トークンが **約 4 倍**になる。
 * そのようなページは 2026-08-12 時点で 1 件も観測していないため、増加幅の実測値はない。
 * 「コスト影響ゼロ」と一般化してはいけない。
 */
export const LLM_INPUT_BUDGET_CHARS = 60_000;

/**
 * プロンプトのテンプレート部 (Few-shot 等) が占めるトークン数。
 *
 * ## 導出 (観測ログ 21 本の実測、2026-08-12)
 *
 * 各実行の `promptTokens` から「本文の文字数 / `CHARS_PER_TOKEN_WORST_CASE`」を
 * 差し引いて算出。**本文分を最悪値で見積もる = テンプレ分が最小に出る**ため、
 * 得られる値は保守的に小さい側に寄る。
 *
 * | 統計 | tokens |
 * |---|---|
 * | 最小 | 20,921 |
 * | 平均 | 23,967 |
 * | **最大** | **25,125** |
 *
 * **実測最大を採用する。** 平均や切りの良い数字を使うと過小評価になり、
 * 予算が窓に収まるという結論が実態より甘くなる (= 危険な方向)。
 *
 * ⚠️ **この値は機械的に導出できない。** 正確に求めるには読み込み済み YAML
 * テンプレートに対して tokenizer を走らせる必要があり、それは Layer 1 テストの
 * 範囲を超える (観測ログは gitignored のため CI からも参照できない)。
 * つまり **Few-shot を大幅に増やしても、この定数が陳腐化したことを検出する仕組みは
 * ない**。`LLM_INPUT_BUDGET_CHARS` が 7 ヶ月間放置されたのと同じ構造のリスクが、
 * 1 段removed な形でここに残っている。
 *
 * 緩和策として、(a) 実測手順を本 docstring に残す (上表の算出方法) (b) 予算全体を
 * 窓の 50% 未満に抑える方針をテストで固定する — の 2 つで、多少の陳腐化では
 * ハード制約を破らないようにしてある。**Few-shot を大きく増やす変更をする際は、
 * 本定数を実測し直すこと。**
 */
export const EXTRACTION_TEMPLATE_TOKENS_ESTIMATE = 25_125;

/**
 * `detail-extraction` の出力トークン上限。**`extraction.service.ts` が実際に
 * `maxTokens` へ渡す値**であり、本モジュールが唯一の定義元。
 *
 * ## なぜここに置くか
 *
 * 以前は `extraction.service.ts` 内のインラインリテラル (`maxTokens: 4000`) で、
 * 予算計算 (`NON_CONTENT_TOKENS_ESTIMATE`) とは**何のつながりもなかった**。
 * この値は過去に `// HTML全文対応のため増加` というコメント付きで変更された履歴が
 * あり、今後も変わりうる。**変わっても予算計算が追随せず、テストも落ちない**という
 * 穴が残っていた (`SMALLEST_CONTEXT_WINDOW_TOKENS` に対して drift guard を入れたのと
 * 同じ種類の問題)。
 *
 * そこで定義元を予算モジュール側へ移し、`NON_CONTENT_TOKENS_ESTIMATE` が**構造的に
 * 導出される**ようにした。drift guard で検知するのではなく、**そもそも drift しない**。
 *
 * ⚠️ 逆向きの import (`compact-html` → `extraction.service`) は循環になるため、
 * 定義元を本モジュールに置き `extraction.service.ts` が参照する向きにしている。
 */
export const EXTRACTION_MAX_OUTPUT_TOKENS = 4_000;

/**
 * 本文以外がプロンプト + 応答で占めるトークン数 (テンプレート + 出力)。
 *
 * `LLM_INPUT_BUDGET_CHARS` が最小のコンテキスト窓に収まることをテストで検証するために
 * 使う。**リテラルを書かず内訳から導出する**ことで、`maxTokens` を変えたら自動的に
 * ここも変わり、制約テストが再評価される。
 */
export const NON_CONTENT_TOKENS_ESTIMATE =
  EXTRACTION_TEMPLATE_TOKENS_ESTIMATE + EXTRACTION_MAX_OUTPUT_TOKENS;

/**
 * サポートする provider のうち**最小**のコンテキスト窓 (tokens)。
 *
 * 2026-08-12 時点では Anthropic `claude-sonnet-4-5-20250929` の 200,000。
 * provider 非依存の実装である以上、予算はここに合わせる必要がある。
 *
 * ⚠️ **この値は `DEFAULT_CLAUDE_MODEL` と機械的に連動していない。** 既定の Anthropic
 * モデルが別の窓サイズのものへ変わっても、本定数は自動では追随しない —
 * まさに本 PR が `LLM_INPUT_BUDGET_CHARS` について直している「根拠が実態から
 * 剥がれる」リスクの 1 段上の再演にあたる。そこで **`compact-html.test.ts` に
 * `DEFAULT_CLAUDE_MODEL` の値を固定する drift guard を置き**、モデルが変わったら
 * テストが落ちて本定数の再確認を強制する形にしてある。
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/context-windows
 */
export const SMALLEST_CONTEXT_WINDOW_TOKENS = 200_000;

/**
 * 保持する属性。これ以外は落とす。
 *
 * `href` を保持する理由は module docstring 参照 (会場一覧がリンク集のサイトがある)。
 */
const KEEP_ATTRIBUTES = new Set(['href', 'alt', 'title', 'id']);

/**
 * 丸ごと削除するタグ。
 *
 * ⚠️ `meta` / `link` / `title` は**含めない**。`extractContentHtml` の
 * フォールバック経路は head 情報 (`title` / `meta[og:*]`) を本文の前に連結するため、
 * ここで消すと og 情報が失われる。本モジュールは body 部分にのみ適用する想定だが、
 * 誤って全体に適用されても壊れないよう対象から外しておく。
 */
const DROP_TAGS = ['script', 'style', 'noscript', 'svg', 'source', 'picture', 'iframe'];

/** 空要素として削除してよいタグ。`table` / `br` / `hr` は構造を持つため含めない。 */
const EMPTY_CANDIDATE_TAGS = 'div,span,p,li,ul,ol,section,figure,a';

/** 空判定の際に「中身あり」とみなす要素。これらがあれば空とみなさない。 */
const STRUCTURAL_TAGS = 'img,br,hr,table';

/** unwrap 対象のラッパータグ。 */
const WRAPPER_TAGS = 'div,span';

/** 収束するまでの最大パス数。無限ループを避けるための安全弁。 */
const MAX_PASSES = 8;

/** 圧縮の結果と、効果を数値で示すための統計。 */
export interface CompactHtmlResult {
  /** 圧縮後の HTML */
  html: string;
  /** 圧縮前の文字数 */
  beforeChars: number;
  /** 圧縮後の文字数 */
  afterChars: number;
  /** 圧縮後の実テキスト文字数 (マークアップを除いた量) */
  textChars: number;
}

/**
 * cheerio が再エスケープした `&amp;` を `&` へ戻す。
 *
 * ## なぜ必要か
 *
 * 会場名に `&` を含むブランドが実在する (`BOX cafe&space ...`)。**実サイトは生の `&`
 * で書いており** (`conan-cafe.jp` で `cafe&space` 7 件 / `cafe&amp;space` 0 件)、
 * 既存記事も 61 箇所すべて `BOX cafe&space` である。cheerio 1.2.0 は
 * `decodeEntities: false` を無視して必ず `&amp;` へ再エスケープするため、
 * 放置すると LLM が `venue_label` に `&amp;` を含めるおそれがある。
 * そうなると既存記事と `venues` マスタの名寄せが壊れる。
 *
 * 実測上は現行パイプライン (本モジュール導入前) でも `&amp;` が混入しており、
 * それでも抽出結果は `'BOX cafe&space GEMS渋谷店'` と正しかった = LLM が正規化して
 * いる。つまり致命的ではないが、**圧縮によって通す本文が増えると `&amp;` も増える**
 * ため、増幅させないよう明示的に戻す。
 *
 * ⚠️ **`&lt;` / `&gt;` は戻さない**。戻すと本文中の `<` が偽のタグとして解釈され、
 * 構造を壊す。対象は `&amp;` のみに限定する。
 */
function restoreAmpersand(html: string): string {
  return html.replace(/&amp;/g, '&');
}

/**
 * 予算に合わせて文字列を切り詰める。**サロゲートペアを割らない**。
 *
 * ## なぜ専用関数にするか
 *
 * 素の `String.prototype.substring` は **UTF-16 コードユニット単位**で切るため、
 * 切断点がサロゲートペアの内側に落ちると**対を欠いた不正な文字**が末尾に残る。
 * `compactHtmlForLlm` は `img` を `[画像: <alt>]` へ畳むので、alt に絵文字を含む
 * ページでは実際にペアが本文へ入りうる。
 *
 * 旧上限 15,000 でも同じリスクはあったが、**予算を 4 倍にすると切断点が実データの
 * 多バイト文字に当たる確率も上がる**ため、ここで塞いでおく。
 *
 * 実装は「切ったあとの末尾が上位サロゲートなら 1 コードユニット戻す」。
 * `Array.from(str).slice(...)` でも同じ結果になるが、60,000 要素の配列を作らずに
 * 済むこちらを選んだ (呼び出しは記事 1 本ごとに走る)。
 *
 * @param text 切り詰め対象
 * @param budgetChars 上限 (コードユニット数)
 * @returns 切り詰め後の文字列と、切り詰めが起きたか
 */
export function truncateForLlm(
  text: string,
  budgetChars: number = LLM_INPUT_BUDGET_CHARS
): { text: string; truncated: boolean } {
  if (text.length <= budgetChars) return { text, truncated: false };

  let end = budgetChars;
  // 上位サロゲート (0xD800-0xDBFF) で終わっていたら対の相手が切れているので 1 つ戻す
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;

  return { text: text.slice(0, end), truncated: true };
}

/** タグを除いた実テキストの文字数を数える。密度の分子。 */
function textLengthOf(html: string): number {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * HTML を情報保全したまま圧縮する。
 *
 * **純粋関数**。入力文字列を変更せず、新しい文字列を返す
 * (`selectMainContent` が `$` を破壊的に変更するのとは対照的)。
 *
 * @param html 圧縮対象の HTML 断片
 * @returns 圧縮後の HTML と、前後の文字数・実テキスト量
 */
export function compactHtmlForLlm(html: string): CompactHtmlResult {
  const beforeChars = html.length;

  // fragment mode (第 3 引数 false) で読む。html/body を勝手に補われると
  // 断片を渡したときに元より大きくなる。
  let $ = cheerio.load(html, null, false);

  // 1. 情報を持たないタグを丸ごと落とす
  $(DROP_TAGS.join(',')).remove();
  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();

  // 2. 属性を落とす (KEEP_ATTRIBUTES 以外)
  $('*').each((_, el) => {
    if (el.type !== 'tag' || !el.attribs) return;
    for (const name of Object.keys(el.attribs)) {
      if (!KEEP_ATTRIBUTES.has(name.toLowerCase())) {
        delete el.attribs[name];
      }
    }
  });

  // 3. img を alt テキストへ畳む。alt が空なら要素ごと落とす。
  //    要素として残すと URL を失った意味のない <img> がタグ分だけ嵩む。
  $('img').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    $(el).replaceWith(alt ? `[画像: ${alt}]` : '');
  });

  // 4. テキストも構造も持たない要素を落とす。入れ子があるため収束まで繰り返す。
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let removed = 0;
    $(EMPTY_CANDIDATE_TAGS).each((_, el) => {
      const $el = $(el);
      if ($el.text().trim() === '' && $el.find(STRUCTURAL_TAGS).length === 0) {
        $el.remove();
        removed++;
      }
    });
    if (removed === 0) break;
  }

  // 5. 「属性なし + 子が 1 要素だけ」の div/span を unwrap する。
  //    ★ここが最も効く (実測 -73%)。CMS が生成する深いラッパーが支配的。
  //    属性を持つものは意味がある可能性があるため対象外。
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let unwrapped = 0;
    $(WRAPPER_TAGS).each((_, el) => {
      if (el.type !== 'tag') return;
      if (Object.keys(el.attribs ?? {}).length > 0) return;
      const $el = $(el);
      const meaningful = $el
        .contents()
        .filter((_, node) => node.type !== 'text' || Boolean(node.data?.trim()));
      if (meaningful.length === 1 && meaningful[0].type === 'tag') {
        $el.replaceWith($el.contents());
        unwrapped++;
      }
    });
    if (unwrapped === 0) break;
  }

  const compacted = restoreAmpersand($.html())
    .replace(/\n\s*\n+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');

  return {
    html: compacted,
    beforeChars,
    afterChars: compacted.length,
    textChars: textLengthOf(compacted),
  };
}
