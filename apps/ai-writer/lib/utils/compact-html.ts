/**
 * LLM へ渡す HTML を、情報を保全したまま圧縮する。
 *
 * ## なぜ必要か
 *
 * `extraction.service.ts` はページ本文を **15,000 文字でハード切り詰め**して
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
 * | 15,000 窓に入った実テキスト | **857 chars** |
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
 * **同じ 15,000 窓に桁違いに多い情報を入れる**。実測 35,344 → 6,786 chars
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
 */
export const CHARS_PER_TOKEN_ESTIMATE = 1.96;

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
 * | − プロンプトのテンプレート部 (Few-shot 等) | −24,000 | 実測 (全体 26,000〜31,400 から本文分を差し引き) |
 * | − 出力 (`extraction.service.ts` の `maxTokens`) | −4,000 | 実装値 |
 * | = 本文に使える理論上の余地 | 172,000 (≒ 337,000 文字) | |
 * | **本定数** | **30,600 (60,000 文字) = 窓の 15%** | |
 *
 * ### なぜ理論上限まで上げないか
 *
 * 1. **`conan-cafe.jp` の圧縮前 35,344 文字を包含する**。圧縮が将来退行しても会場一覧は届く
 * 2. 総プロンプトが ≒ 55,000 tokens = Sonnet 4.5 の **27%** に収まり、3 provider すべてで余裕
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
 * ### コストへの影響は実質ゼロ
 *
 * 圧縮後の実測は conan 6,653 / sw2026 2,939 / kusuriya 2,440 / bluelock 2,103 文字で
 * **すべて旧上限 15,000 未満**。つまり通常は上限に到達せず、引き上げても送信量は
 * 変わらない。上限が効くのは圧縮しても収まらない例外的なページだけ。
 */
export const LLM_INPUT_BUDGET_CHARS = 60_000;

/**
 * 本文以外がプロンプトで占めるトークン数の実測上限 (テンプレート + 出力)。
 *
 * `LLM_INPUT_BUDGET_CHARS` が最小のコンテキスト窓に収まることをテストで検証するために
 * 使う。値の出所は上の内訳表 (テンプレート 24,000 + 出力 `maxTokens` 4,000)。
 */
export const NON_CONTENT_TOKENS_ESTIMATE = 28_000;

/**
 * サポートする provider のうち**最小**のコンテキスト窓 (tokens)。
 *
 * 2026-08-12 時点では Anthropic `claude-sonnet-4-5-20250929` の 200,000。
 * provider 非依存の実装である以上、予算はここに合わせる必要がある。
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
