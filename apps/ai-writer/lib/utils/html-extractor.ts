/**
 * HTML Article Extractor
 * 記事本文HTMLを抽出するユーティリティ
 *
 * セレクタ優先順位:
 * 1. main
 * 2. article
 * 3. [role="main"]
 * 4. [role="article"]
 * 5. .entry-content (WordPress standard)
 * 6. .post-content (WordPress theme)
 * 7. .article__main-text-area (nijimen.kusuguru.co.jp)
 * 8. フォールバック: 完全なHTML
 *
 * main を最優先とする理由:
 * - article よりも広い範囲をカバー
 * - 関連リンクセクション（公式URLなど）も含まれることが多い
 * - 記事本文 + 関連情報を一括取得できる
 *
 * デバッグモード:
 * 環境変数 DEBUG_HTML_EXTRACTION=true で有効化
 * 抽出したHTMLを debug-logs/ ディレクトリに保存
 */

import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Agent } from 'undici';

import { compactHtmlForLlm, LLM_INPUT_BUDGET_CHARS } from '@/lib/utils/compact-html';
import { BROWSER_USER_AGENT, FETCH_TIMEOUT_MS } from '@/lib/utils/http-constants';

/**
 * SSL証明書エラーのコード一覧
 * これらのエラーが発生した場合、SSL検証をスキップしてリトライする
 */
const SSL_CERTIFICATE_ERROR_CODES = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', // 中間証明書が不完全
  'CERT_HAS_EXPIRED', // 証明書期限切れ
  'DEPTH_ZERO_SELF_SIGNED_CERT', // 自己署名証明書
  'SELF_SIGNED_CERT_IN_CHAIN', // チェーン内に自己署名証明書
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', // ローカルで発行者証明書を取得できない
] as const;

/**
 * SSL証明書エラーかどうかを判定
 *
 * @param error キャッチしたエラー
 * @returns SSL証明書関連のエラーの場合 true
 */
function isCertificateError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  // Node.js fetch のエラー構造: error.cause.code
  const cause = (error as { cause?: { code?: string } }).cause;
  if (cause?.code && SSL_CERTIFICATE_ERROR_CODES.includes(cause.code as typeof SSL_CERTIFICATE_ERROR_CODES[number])) {
    return true;
  }

  // エラーメッセージでも判定（フォールバック）
  const message = (error as { message?: string }).message || '';
  return SSL_CERTIFICATE_ERROR_CODES.some(code =>
    message.includes(code) || message.includes('certificate')
  );
}

/**
 * SSL検証をスキップする Agent
 * 証明書チェーンに問題があるサイト用
 */
const sslSkipAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

/**
 * SSL検証をスキップして fetch を実行
 *
 * @param url フェッチ先URL
 * @param options fetch オプション
 * @returns Response
 */
async function fetchWithSSLSkip(url: string, options: RequestInit = {}): Promise<Response> {
  // undici の dispatcher オプションで Agent を指定
  return fetch(url, {
    ...options,
    // @ts-expect-error - Node.js の fetch は dispatcher をサポート
    dispatcher: sslSkipAgent,
  });
}

/**
 * SSL証明書エラー時に自動リトライする fetch ラッパー
 *
 * 1. まず通常の SSL 検証でリクエスト
 * 2. SSL証明書エラーの場合のみ、検証スキップでリトライ
 * 3. リトライ時は警告ログを出力
 *
 * @param url フェッチ先URL
 * @param options fetch オプション
 * @returns Response
 */
async function fetchWithSSLFallback(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    // 通常の SSL 検証で試行
    return await fetch(url, options);
  } catch (error) {
    // SSL 証明書エラーの場合のみリトライ
    if (isCertificateError(error)) {
      const hostname = new URL(url).hostname;
      console.warn(
        `⚠️ [HTMLExtractor] SSL証明書エラー検出 (${hostname}): 検証スキップでリトライします`
      );
      console.warn(
        `   → 原因: サーバー側の証明書チェーン設定不備の可能性があります`
      );

      return await fetchWithSSLSkip(url, options);
    }

    // その他のエラーはそのまま throw
    throw error;
  }
}

/**
 * セレクタ優先順位
 * より意味的に明確な要素から順に試行
 *
 * main を最優先: article よりも広い範囲をカバーし、
 * 関連リンクセクション（公式URLなど）も含まれることが多い
 */
const ARTICLE_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '[role="article"]',
  '.entry-content', // WordPress standard
  '.post-content', // WordPress theme
] as const;

/**
 * コンテンツ抽出時に除去する要素
 * (extractContentHtml で使用)
 *
 * 前半は「描画されないもの」、後半は「ページの外枠 (chrome)」。
 *
 * ★ 外枠の除去は 2026-08-12 追加。それまで `script` 系しか落としておらず、
 *   `ARTICLE_SELECTORS` 6 種すべてが外れたページでは **`nav` が 3 個そのまま
 *   LLM へ渡っていた**。sw2026 の実測では `TOKYO INFO` / `OSAKA INFO` という
 *   ナビ文言だけが残り、抽出が「大阪があるらしい」と察して会場名を捏造する
 *   材料になっていた。
 *
 * ⚠️ **除去はドキュメント全体に効く (body 直下に限定されない)。** 本文ブロックの
 *   **内部にネストした** `nav` / `aside` / `form` も一緒に落ちる。実測 8 サイトでは
 *   該当がなかったが、「本文内のページ内ジャンプ nav」「本文内の補足 aside」
 *   「説明文込みの予約 form」を持つサイトが来ると本文の一部を失う。
 *
 *   限定しない判断の根拠: 外枠は body 直下にあるとは限らない (ラッパ div の中に
 *   header/nav を置くサイトが多数)。直下限定にすると**今直したはずの捏造材料が
 *   そのまま残る**ため、取りこぼしより誤情報の生成を重く見た。
 *
 *   監視方法: `MainContentSelection.bodyTextLength` → `bodyTextLengthAfterRemoval`
 *   の差分が「除去で落ちたテキスト量」。運用ログに 3 段で出しているので、
 *   本文まで落ちている疑いはこの差分の異常な大きさとして観測できる。
 *   Phase 3.6-3 の再実測ではこの値も確認する。
 */
const CONTENT_REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  // ページの外枠。本文ではないうえ、ナビ文言が推測の材料になる
  'nav',
  'header',
  'footer',
  'aside',
  'form',
] as const;

/**
 * `selectMainContent` が「本文らしい」と判定するのに必要な最小テキスト量 (文字)。
 *
 * これを下回る要素しか無いページでは body 全体へ倒す。分割した結果が元より痩せる
 * ことを避けるための下限で、実測 (LTR 8 サイト) の本文はいずれも数千文字ある。
 */
const MIN_MAIN_CONTENT_TEXT_LENGTH = 200;

/**
 * 本文らしいブロックの選定結果。呼び出し元がログに出せるよう経緯も返す。
 */
export interface MainContentSelection {
  /** 選ばれたブロックの innerHTML */
  html: string;
  /** `largest-child` = body 直下から選んだ / `body` = 選べず body 全体 */
  strategy: 'largest-child' | 'body';
  /** 選ばれた要素の説明 (`div.page-content-wrapper` 等)。body 全体なら null */
  selectedElement: string | null;
  /**
   * **外枠を除去する前**の body テキスト量。
   *
   * ⚠️ 削減効果 (`-45%` 等) はこの値を起点に測る。除去後を起点にすると、
   * **外枠除去の効果が丸ごと勘定から抜け落ちて、実際より小さい削減率が記録される**。
   */
  bodyTextLength: number;
  /** 外枠を除去した後、ブロック選定の前の body テキスト量 */
  bodyTextLengthAfterRemoval: number;
  /** 選定後のテキスト量 */
  selectedTextLength: number;
  /**
   * 2 位の候補が 1 位に十分近い場合だけ入る (テキスト量が 1 位の
   * `RUNNER_UP_RATIO_THRESHOLD` 以上)。
   *
   * ⚠️ **本文が 2 つの兄弟要素に割れているページの診断材料。** 片方だけを選ぶと
   * もう片方を黙って捨てることになるが、どちらが本文かは機械的に決められない。
   * 挙動は変えず (1 位を選ぶ)、その事実を観測できるようにする。
   */
  runnerUp?: { label: string; textLength: number; ratio: number };
}

/**
 * 2 位の候補を「1 位に十分近い」とみなす比率。
 *
 * 0.8 は「本文が 2 分割されている」を拾い、「本文 + サイドバー」程度の差は拾わない
 * ことを狙った値。閾値を跨いだからといって挙動は変わらない (warn を出すだけ) ため、
 * 厳密な最適値は要らない。
 */
const RUNNER_UP_RATIO_THRESHOLD = 0.8;

/**
 * セレクタが全滅したときに「本文らしいブロック」を選ぶ。
 *
 * ## 設計 (実測に基づく一般化)
 *
 * 1. **減算を先に効かせる** — `CONTENT_REMOVE_SELECTORS` で外枠ごと落とす。
 *    これが最も確実で、どのサイトでも悪化しない。
 * 2. **body 直下でテキスト量が最大の要素**を選ぶ。
 *
 * 「body 直下の **div**」ではなく「テキスト量が最大の**要素**」にしたのは実測の
 * ためである。
 *
 * | サイト | body 直下 | 正解 |
 * |---|---|---|
 * | sw2026 / toy5 / kusuriya | 8 個 (header / nav ×2 / **div.page-content-wrapper** / modal ×2 / footer) | `page-content-wrapper` |
 * | miku / nissy | 2 個 (`title` / 無名の全体ラッパ div) | ラッパ div = body 全体と同じ |
 *
 * `div` 限定にすると `section` / `main` 以外の semantic 要素を拾えない。テキスト量
 * 基準なら miku / nissy でも「1 個しかない要素」が選ばれ、**現状から劣化しない**。
 *
 * @param $ 読み込み済みの cheerio インスタンス。
 *
 * ⚠️ **渡されたインスタンスを破壊的に変更する** (`CONTENT_REMOVE_SELECTORS` の
 * 要素を `remove()` する)。呼び出し元は、除去されて困る情報 (head の `title` /
 * `og:*` 等) を**この関数より前に**取り出しておくこと。
 *
 * HTML 文字列ではなくインスタンスを受けるのは、`extractContentHtml` が既に
 * `cheerio.load()` を済ませているため。文字列で受けると同じ HTML を 2 回 parse する
 * ことになる (フォールバック経路は数十 KB の body 全体が対象)。
 */
export function selectMainContent($: cheerio.CheerioAPI): MainContentSelection {
  // ★ 除去より前に測る。除去後を起点にすると「外枠を落とした効果」が勘定から抜け、
  //   運用ログの削減率が実際より小さく出る (PR 本文の -45% と食い違う)。
  const bodyTextLength = $('body').text().replace(/\s+/g, '').length;

  for (const selector of CONTENT_REMOVE_SELECTORS) {
    $(selector).remove();
  }

  const bodyHtml = $('body').html() ?? '';
  const bodyTextLengthAfterRemoval = $('body').text().replace(/\s+/g, '').length;

  const candidates = $('body')
    .children()
    .toArray()
    .map((el) => {
      const $el = $(el);
      const tagName = (el as { tagName?: string }).tagName ?? 'unknown';
      // `class=" a b"` のように先頭が空白だと split の 1 要素目が空文字になり、
      // ラベルが `div.` になって読めなくなる。trim を挟む。
      const firstClass = $el.attr('class')?.trim().split(/\s+/)[0];
      return {
        label: firstClass ? `${tagName}.${firstClass}` : tagName,
        // ⚠️ ここで `.html()` を呼ばない。使うのは 1 位だけなので、全候補を
        //    シリアライズすると modal 等の大きな未選択要素のコストを丸ごと払う。
        $el,
        textLength: $el.text().replace(/\s+/g, '').length,
      };
    })
    // テキスト量の降順。2 位を取れるようにするため reduce ではなく sort で並べる。
    .sort((a, b) => b.textLength - a.textLength);

  const best = candidates[0] ?? null;

  // 選べない / 選んだ結果が痩せすぎる場合は body 全体へ倒す。
  // 「分割したせいで元より情報が減った」を避けるのが目的。
  if (!best || best.textLength < MIN_MAIN_CONTENT_TEXT_LENGTH) {
    return {
      html: bodyHtml,
      strategy: 'body',
      selectedElement: null,
      bodyTextLength,
      bodyTextLengthAfterRemoval,
      selectedTextLength: bodyTextLengthAfterRemoval,
    };
  }

  // 2 位が 1 位に十分近ければ、本文が兄弟に割れている疑いを残す。
  // 挙動は変えない (1 位を選ぶ)。黙って片方を捨てないことが目的。
  const second = candidates[1];
  const runnerUp =
    second && best.textLength > 0 && second.textLength / best.textLength >= RUNNER_UP_RATIO_THRESHOLD
      ? {
          label: second.label,
          textLength: second.textLength,
          ratio: second.textLength / best.textLength,
        }
      : undefined;

  if (runnerUp) {
    console.warn(
      `[HTMLExtractor] ⚠️ 本文が兄弟要素に割れている可能性: ` +
        `1 位 ${best.label} (${best.textLength} 文字) に対し ` +
        `2 位 ${runnerUp.label} (${runnerUp.textLength} 文字, ` +
        `${Math.round(runnerUp.ratio * 100)}%) を捨てています`
    );
  }

  return {
    // 勝者が決まってから初めてシリアライズする。
    html: best.$el.html() ?? '',
    strategy: 'largest-child',
    selectedElement: best.label,
    bodyTextLength,
    bodyTextLengthAfterRemoval,
    selectedTextLength: best.textLength,
    ...(runnerUp ? { runnerUp } : {}),
  };
}

/**
 * head 内で保持するセレクタ
 * (extractContentHtml で使用)
 */
const HEAD_KEEP_SELECTORS = [
  'title',
  'meta[name="description"]',
  'meta[property^="og:"]',
] as const;

// タイムアウトと User-Agent は検証ツール (`fetch-html.ts`) と共有する。
// 別々に持つと「パイプラインが見た HTML」と「検証が見た HTML」が別物になり、
// 不一致が出たときにどちらが誤りか判別できなくなる。

/**
 * 異常に小さいHTMLと判定する閾値（bytes）
 * 通常の記事HTMLは数十KB以上あるため、1KB未満は異常
 */
const MIN_HTML_SIZE_BYTES = 1000;

/**
 * Google リダイレクトURLから実際のURLを抽出
 *
 * @param url 元のURL（Google リダイレクトURLの可能性あり）
 * @returns 実際のURL
 *
 * @example
 * extractActualUrl('https://www.google.com/url?url=https://example.com')
 * // => 'https://example.com'
 */
export function extractActualUrl(url: string): string {
  // Google リダイレクトURLの場合
  if (url.includes('google.com/url')) {
    try {
      // URLを '?' で分割してクエリパラメータ部分を取得
      const queryString = url.split('?')[1];
      if (!queryString) {
        console.warn(`[HTMLExtractor] Google URL detected but no query string found: ${url}`);
        return url;
      }

      const urlParams = new URLSearchParams(queryString);
      const actualUrl = urlParams.get('url');

      if (actualUrl) {
        console.log(`[HTMLExtractor] Google リダイレクトURL検出: ${url.substring(0, 100)}...`);
        console.log(`[HTMLExtractor] 実際のURL抽出: ${actualUrl}`);
        return actualUrl;
      } else {
        console.warn(`[HTMLExtractor] Google URL detected but 'url' parameter not found: ${url}`);
        return url;
      }
    } catch (error) {
      console.error(`[HTMLExtractor] Failed to extract actual URL from Google redirect:`, error);
      return url;
    }
  }

  // その他のリダイレクトURLパターン（将来的な拡張用）
  // 例: bit.ly, t.co など

  return url;
}

/**
 * `saveHtmlForDebug` が保存する HTML の段階。
 *
 * @description
 * 本ファイルは **7 箇所から別々の段階の HTML** を保存する。ファイル名に段階が
 * 入っていないと「最新のファイル」を掴んだときにどの段階を引いたか分からず、
 * 実際に事故が起きた:
 *
 * `verify-against-source.ts --html` に `content-compacted` を渡すと、圧縮で
 * class 属性が全て落ちているため正解データが `unsupported` を返す。これは
 * 「**profile が未対応**」に見えるが、実際は「**入力ファイルの段階が違う**」。
 *
 * ⚠️ 会場ブロックの照合に使えるのは `class` が残っている段階だけ
 * (`article-selected` / `article-full` / `data-selected` / `data-full`)。
 * `content-compacted` と `content-cleaned` は圧縮を通っているため使えない。
 */
type DebugHtmlStage =
  /** `extractArticleHtml`: セレクタ命中ブロックの生 innerHTML */
  | 'article-selected'
  /** `extractArticleHtml`: セレクタ不発でページ全体の生 HTML へフォールバック */
  | 'article-full'
  /** `extractArticleData`: セレクタ命中ブロックの生 innerHTML */
  | 'data-selected'
  /** `extractArticleData`: セレクタ不発でページ全体の生 HTML へフォールバック */
  | 'data-full'
  /**
   * `extractContentHtml`: 圧縮前のページ全体 (= `ContentHtmlResult.raw`)。
   *
   * **会場の網羅性ゲートが照合に使う入力そのもの。** これを保存しておくと
   * `verify-against-source.ts --html` で「ゲートが何を見たか」を後から
   * オフラインで再現できる (S1-d Phase 3.8 Step A)。
   */
  | 'content-raw'
  /** `extractContentHtml`: LLM 入力用に圧縮した後 (class 属性なし) */
  | 'content-compacted'
  /** `extractContentHtml`: head 情報 + 圧縮済み body を連結した後 (class 属性なし) */
  | 'content-cleaned';

/**
 * デバッグモード時にHTMLをファイルに保存
 *
 * @param html 保存するHTML
 * @param url 元のURL（ファイル名生成に使用）
 * @param stage どの段階の HTML か（ファイル名に含めて後から判別できるようにする）
 */
async function saveHtmlForDebug(
  html: string,
  url: string,
  stage: DebugHtmlStage
): Promise<void> {
  // 環境変数チェック
  if (process.env.DEBUG_HTML_EXTRACTION !== 'true') {
    return;
  }

  try {
    // debug-logs ディレクトリを作成
    const debugDir = path.join(process.cwd(), 'debug-logs');
    await fs.mkdir(debugDir, { recursive: true });

    // ファイル名生成（タイムスタンプ + URL由来 + 段階）
    //
    // ⚠️ 段階は**末尾**に置く。既存ファイル (段階なし) と混在しても
    // `html-{hostname}-{timestamp}` の前方一致検索がそのまま効くようにするため。
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const urlSlug = new URL(url).hostname.replace(/\./g, '-');
    const filename = `html-${urlSlug}-${timestamp}-${stage}.html`;
    const filepath = path.join(debugDir, filename);

    // HTMLを保存
    await fs.writeFile(filepath, html, 'utf-8');

    console.log(`[HTMLExtractor] 🐛 デバッグHTML保存: debug-logs/${filename}`);
  } catch (error) {
    console.error('[HTMLExtractor] デバッグHTMLの保存に失敗:', error);
  }
}

/**
 * 記事HTMLを抽出
 *
 * @param url 記事URL（Google リダイレクトURLの場合は自動的に実際のURLを抽出）
 * @returns 抽出された記事HTML（見つからない場合は完全なHTML）
 * @throws フェッチエラー、タイムアウトエラー
 */
export async function extractArticleHtml(url: string): Promise<string> {
  try {
    // Google リダイレクトURLから実際のURLを抽出
    const actualUrl = extractActualUrl(url);

    console.log(`[HTMLExtractor] フェッチ開始: ${actualUrl}`);

    // タイムアウト付きフェッチ
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetchWithSSLFallback(actualUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log(`[HTMLExtractor] HTML取得完了: ${html.length} bytes`);

    // 異常に小さいHTMLの警告
    if (html.length < MIN_HTML_SIZE_BYTES) {
      console.warn(
        `[HTMLExtractor] ⚠️  異常に小さいHTML検出: ${html.length} bytes (通常は数十KB以上)`
      );
      console.warn(`[HTMLExtractor] HTMLプレビュー（最初の500文字）:\n${html.substring(0, 500)}`);
    }

    // cheerioでパース
    const $ = cheerio.load(html);

    // セレクタ優先順位で抽出を試行
    let selectorTrials: Array<{ selector: string; found: boolean; length?: number }> = [];

    for (const selector of ARTICLE_SELECTORS) {
      const element = $(selector).first();

      if (element.length > 0) {
        const extractedHtml = element.html();

        if (extractedHtml && extractedHtml.trim().length > 0) {
          console.log(
            `[HTMLExtractor] ✅ 抽出成功: selector="${selector}", length=${extractedHtml.length} bytes`
          );

          // HTMLプレビュー（デバッグ用）
          const preview = extractedHtml
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
          console.log(`[HTMLExtractor] 抽出HTMLプレビュー: ${preview}...`);

          // デバッグモード時にHTMLを保存
          await saveHtmlForDebug(extractedHtml, actualUrl, 'article-selected');

          return extractedHtml;
        } else {
          selectorTrials.push({ selector, found: true, length: 0 });
        }
      } else {
        selectorTrials.push({ selector, found: false });
      }
    }

    // すべてのセレクタで見つからない場合はフォールバック
    //
    // ★ ここには `extractContentHtml` と違って `selectMainContent()` を**意図的に
    //   適用していない**。同じ関数の同じ症状に見えるが、解いている問題が別のため。
    //
    //   | 関数 | 入力 | 下流の目的 |
    //   |---|---|---|
    //   | `extractArticleHtml` (本関数) | RSS 記事ページ | **公式 URL を見つける** (article-selection) |
    //   | `extractContentHtml` | 公式サイト | 会場・期間を読む (detail-extraction) |
    //
    //   `official_urls[]` は**このページ内のリンクから作られる**。`nav` / `footer` を
    //   落とすと候補そのものが減り、「候補にルート URL が無い」という既知の穴
    //   (1-selection.yaml v2.2.0 が対処しているもの) を悪化させる。
    //
    //   ノイズ削減の利得より候補喪失の損失が大きいと判断して見送った。将来ここを
    //   触るなら、`official_urls[]` の件数が減っていないことを実データで確かめること。
    console.warn(`[HTMLExtractor] ⚠️  セレクタで要素が見つからないため、完全なHTMLを返します`);
    console.warn(`[HTMLExtractor] セレクタ試行結果: ${JSON.stringify(selectorTrials, null, 2)}`);
    console.warn(`[HTMLExtractor] HTMLプレビュー（最初の1000文字）:\n${html.substring(0, 1000)}`);

    // デバッグモード時にHTMLを保存（フォールバック時も保存）
    await saveHtmlForDebug(html, actualUrl, 'article-full');

    return html;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`記事HTMLのフェッチがタイムアウトしました: ${url} (${FETCH_TIMEOUT_MS}ms)`);
      }
      throw new Error(`記事HTMLの取得に失敗: ${url} - ${error.message}`);
    }
    throw new Error(`記事HTMLの取得に失敗: ${url}`);
  }
}

/**
 * 複数URLから記事HTMLを抽出（並列処理）
 *
 * @param urls 記事URLの配列
 * @returns 抽出された記事HTMLの配列
 */
export async function extractArticleHtmlBatch(
  urls: string[]
): Promise<Array<{ url: string; html: string | null; error?: string }>> {
  const results = await Promise.allSettled(
    urls.map(async url => ({
      url,
      html: await extractArticleHtml(url),
    }))
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        url: urls[index],
        html: null,
        error: result.reason?.message || 'Unknown error',
      };
    }
  });
}

/**
 * URLからタイトルと記事HTMLを抽出
 *
 * タイトル抽出優先順位:
 * 1. Open Graph title (<meta property="og:title">)
 * 2. HTML title (<title>)
 * 3. H1 tag (<h1>)
 * 4. フォールバック: URLから生成
 *
 * @param url 記事URL（Google リダイレクトURLの場合は自動的に実際のURLを抽出）
 * @returns タイトル、記事HTML、実際のURL
 * @throws フェッチエラー、タイムアウトエラー
 */
export async function extractArticleData(url: string): Promise<{
  title: string;
  html: string;
  actualUrl: string;
}> {
  try {
    // Google リダイレクトURLから実際のURLを抽出
    const actualUrl = extractActualUrl(url);

    console.log(`[HTMLExtractor] フェッチ開始: ${actualUrl}`);

    // タイムアウト付きフェッチ
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetchWithSSLFallback(actualUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }

    const fullHtml = await response.text();
    console.log(`[HTMLExtractor] HTML取得完了: ${fullHtml.length} bytes`);

    // cheerioでパース
    const $ = cheerio.load(fullHtml);

    // タイトル抽出（優先順位順）
    let title = '';

    // 1. Open Graph title
    const ogTitle = $('meta[property="og:title"]').attr('content');
    if (ogTitle && ogTitle.trim()) {
      title = ogTitle.trim();
      console.log(`[HTMLExtractor] ✅ タイトル抽出 (og:title): ${title}`);
    }

    // 2. HTML title
    if (!title) {
      const htmlTitle = $('title').text();
      if (htmlTitle && htmlTitle.trim()) {
        title = htmlTitle.trim();
        console.log(`[HTMLExtractor] ✅ タイトル抽出 (title): ${title}`);
      }
    }

    // 3. H1 tag
    if (!title) {
      const h1Title = $('h1').first().text();
      if (h1Title && h1Title.trim()) {
        title = h1Title.trim();
        console.log(`[HTMLExtractor] ✅ タイトル抽出 (h1): ${title}`);
      }
    }

    // 4. フォールバック: URLから生成
    if (!title) {
      const urlObj = new URL(actualUrl);
      title = `Article from ${urlObj.hostname}`;
      console.warn(`[HTMLExtractor] ⚠️  タイトルが見つからないため、URLから生成: ${title}`);
    }

    // 記事HTML抽出（既存ロジックを再利用）
    let articleHtml = '';
    for (const selector of ARTICLE_SELECTORS) {
      const element = $(selector).first();

      if (element.length > 0) {
        const extractedHtml = element.html();

        if (extractedHtml && extractedHtml.trim().length > 0) {
          articleHtml = extractedHtml;
          console.log(
            `[HTMLExtractor] ✅ 記事HTML抽出成功: selector="${selector}", length=${articleHtml.length} bytes`
          );

          // デバッグモード時にHTMLを保存
          await saveHtmlForDebug(articleHtml, actualUrl, 'data-selected');
          break;
        }
      }
    }

    // すべてのセレクタで見つからない場合はフォールバック
    if (!articleHtml) {
      console.warn(`[HTMLExtractor] ⚠️  セレクタで要素が見つからないため、完全なHTMLを返します`);
      articleHtml = fullHtml;
      await saveHtmlForDebug(fullHtml, actualUrl, 'data-full');
    }

    return {
      title,
      html: articleHtml,
      actualUrl,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(
          `記事データのフェッチがタイムアウトしました: ${url} (${FETCH_TIMEOUT_MS}ms)`
        );
      }
      throw new Error(`記事データの取得に失敗: ${url} - ${error.message}`);
    }
    throw new Error(`記事データの取得に失敗: ${url}`);
  }
}

/**
 * HTMLからページ内のリンクを抽出
 *
 * @param html 解析するHTML
 * @param baseUrl ベースURL（相対URLを絶対URLに変換するため）
 * @returns 抽出されたリンクURL配列（重複排除済み）
 *
 * @description
 * - a[href] 属性からリンクを抽出
 * - 相対URLは絶対URLに変換
 * - javascript:, mailto:, tel: などは除外
 * - 重複は排除
 */
export function extractPageLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: Set<string> = new Set();
  const baseUrlObj = new URL(baseUrl);

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    // 除外パターン
    if (
      href.startsWith('javascript:') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('#') ||
      href === '' ||
      href === '/'
    ) {
      return;
    }

    try {
      // 絶対URLに変換
      const absoluteUrl = href.startsWith('http')
        ? href
        : new URL(href, baseUrlObj.origin).href;

      links.add(absoluteUrl);
    } catch {
      // 無効なURLはスキップ
    }
  });

  console.log(`[HTMLExtractor] 抽出されたリンク: ${links.size}件`);

  return Array.from(links);
}

/**
 * 公式サイトからコンテンツHTMLを抽出（本文抽出用）
 *
 * タイトル抽出用（extractArticleHtml）とは異なり、
 * カスタムランディングページ（main/article要素がないサイト）にも対応。
 *
 * 抽出戦略:
 * 1. head から必要な情報（title, meta description, og:*）を先に確保する
 * 2. 既存のセレクタ（main, article 等）で本文を試行
 * 3. 見つからない場合は `selectMainContent` で外枠を落としてから本文を選ぶ
 * 4. 不要な要素（script, style, noscript 等）を除去
 *
 * 除去する要素（`CONTENT_REMOVE_SELECTORS`）:
 * - script, style, noscript, iframe, svg: 本文に寄与しない
 * - **nav, header, footer, aside, form: サイト共通の外枠**
 *
 * ⚠️ 外枠を残すと、フォールバック経路（body 全体）でグローバルナビや
 * フッターのリンク集が本文と同じ重みで LLM に渡り、**本文にしか書かれていない
 * 会場情報が埋もれる**。実測 (2026-08-11) で sw2026 のサブページが
 * 16,271 → 9,004 bytes (-45%)、kusuriya のトップが 13,798 → 6,197 bytes (-55%)。
 *
 * head の抽出を除去より**前**に行うのはこのため。順序を入れ替えると
 * `title` / `og:*` まで一緒に落ちる。
 *
 * ℹ️ `extractArticleHtml`（タイトル抽出用）は**意図的に外枠を残している**。
 * あちらは `official_urls` の抽出元でもあり、他ページへの参照リンクが要る。
 *
 * @param url 公式サイトURL
 * @returns `compacted` (LLM 入力用) と `raw` (照合用) の 2 本。詳細は
 *   {@link ContentHtmlResult}
 * @throws フェッチエラー、タイムアウトエラー
 */
/**
 * `compactHtmlForLlm` を適用し、削減量を**必ずログへ出す**。
 *
 * 下流 (`extraction.service.ts`) は `LLM_INPUT_BUDGET_CHARS` 文字でハード切り詰めするが、
 * **切り詰めが起きたことはプロンプト本文の `...(truncated)` にしか現れず、
 * ログにも観測レコードにも出ない**。`conan-cafe.jp` で会場一覧が届かず
 * 都市単位に畳まれた不具合 (2026-08-12) は、この沈黙のせいで発見が偶然に頼った。
 *
 * そこで圧縮の効果と「窓に収まるか」をここで loud に出す。前セッションで
 * `console.warn` がログに載っておらず「警告ゼロ」と誤判断しかけたのと同じクラスの
 * 問題を作らないため。
 */
function logCompaction(html: string, label: string): string {
  const { html: compacted, beforeChars, afterChars, textChars } = compactHtmlForLlm(html);
  const densityBefore = ((textChars / beforeChars) * 100).toFixed(1);
  const densityAfter = ((textChars / afterChars) * 100).toFixed(1);

  console.log(
    `[HTMLExtractor:Content] 圧縮 (${label}): ` +
      `${beforeChars.toLocaleString()} → ${afterChars.toLocaleString()} 文字 ` +
      `/ 密度 ${densityBefore}% → ${densityAfter}% ` +
      `/ 実テキスト ${textChars.toLocaleString()} 文字`
  );

  // 下流の切り詰め上限。ここを超えると本文の後半が LLM へ届かない。
  if (afterChars > LLM_INPUT_BUDGET_CHARS) {
    console.warn(
      `[HTMLExtractor:Content] ⚠️ 圧縮後も ${LLM_INPUT_BUDGET_CHARS.toLocaleString()} 文字を超えています ` +
        `(${afterChars.toLocaleString()} 文字)。detail-extraction で後半が切り捨てられ、` +
        `ページ後方の情報 (会場一覧・会場別期間など) が LLM へ届かないおそれがあります`
    );
  }

  return compacted;
}

/**
 * `extractContentHtml` の戻り値。
 *
 * ## なぜ 2 本返すのか (2026-08-14、S1-d Phase 3.8 Step A)
 *
 * 圧縮 (`compactHtmlForLlm`) は `KEEP_ATTRIBUTES` (`href` / `alt` / `title` / `id`)
 * 以外の属性を**全て落とす**。**`class` はここに含まれないため全滅する** —
 * `conan-cafe.jp` の実測で 211 個 → **0 個**。
 *
 * 一方 `source-truth-extractor.ts` の `SITE_PROFILES` は会場ブロックを
 * `.place` (ltr) / `.p-top-information__bloc` (hivelocity) という **class セレクタ**
 * で探す。よって圧縮後 HTML を照合へ渡すと**どのサイトも `unsupported`** になる。
 *
 * 🔴 しかも `unsupported` は設計上「**判定せず通す**」(判定できないことを不合格に
 * しない = Phase 3.5 からの一貫方針) ため、**ゲートが 1 度も発火しないまま
 * loud にも停まらない**。「圧縮後を渡す」は静かに機能を殺す種類の誤りなので、
 * 戻り値の型で圧縮前を持ち回すことを強制する。
 *
 * ## `raw` に何を入れるか
 *
 * **フェッチしたページ全体** (`fullHtml`) を入れる。セレクタ命中ブロックの生
 * innerHTML ではない。理由は 2 つ:
 *
 * 1. `ARTICLE_SELECTORS` 命中経路は保存 HTML 281 本の実測で **0/281** = 実運用では
 *    一度も発火していない。命中ブロックを `raw` にすると、実際に通る
 *    フォールバック経路には対応する値が存在しない
 * 2. フルページと本文選定後で**会場ブロック数は 281/281 一致**した。絞る利得は
 *    ゼロで、取りこぼすリスクだけが増える。誤差の方向も重要で、余分な会場ブロックが
 *    混ざれば「偽の停止」(人が気づく) だが、取りこぼせば `unsupported` →
 *    **黙って通過** (気づけない)
 *
 * ⚠️ `selectMainContent($)` は `$` を破壊的に変更するため、**後から `$` を使って
 * 圧縮前を再構成することはできない**。`fullHtml` を持ち回すこと。
 */
export interface ContentHtmlResult {
  /**
   * LLM 入力用に圧縮した HTML。**class 属性は落ちている。**
   *
   * 従来 `extractContentHtml` が返していたものと同一で、下流 (detail-extraction /
   * subpage-detection / category-image-extraction / content-generation /
   * image-upload-r2) はすべてこちらを受け取る (挙動不変)。
   */
  compacted: string;
  /**
   * 圧縮前のページ全体 HTML。**class 属性が残っている。**
   *
   * 正解データ抽出 (`extractSourceTruth`) 専用。**LLM へ渡してはならない**
   * (圧縮前は `conan-cafe.jp` で 105,218 bytes あり、入力予算 60,000 文字を大きく
   * 超えて後半が切り捨てられる)。
   */
  raw: string;
}

export async function extractContentHtml(url: string): Promise<ContentHtmlResult> {
  try {
    // Google リダイレクトURLから実際のURLを抽出
    const actualUrl = extractActualUrl(url);

    console.log(`[HTMLExtractor:Content] フェッチ開始: ${actualUrl}`);

    // タイムアウト付きフェッチ
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetchWithSSLFallback(actualUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }

    const fullHtml = await response.text();
    console.log(`[HTMLExtractor:Content] HTML取得完了: ${fullHtml.length} bytes`);

    // ★ 照合用 (`raw`) をそのまま保存する。圧縮後しか残っていないと
    //   「ゲートが何を見て unsupported と判定したか」を後から確認できない。
    await saveHtmlForDebug(fullHtml, actualUrl, 'content-raw');

    // cheerioでパース
    const $ = cheerio.load(fullHtml);

    // まず既存のセレクタで試行
    for (const selector of ARTICLE_SELECTORS) {
      const element = $(selector).first();

      if (element.length > 0) {
        const extractedHtml = element.html();

        if (extractedHtml && extractedHtml.trim().length > 0) {
          console.log(
            `[HTMLExtractor:Content] ✅ セレクタ抽出成功: "${selector}", ${extractedHtml.length} bytes`
          );

          // 下流 (`extraction.service.ts`) は `LLM_INPUT_BUDGET_CHARS` 文字で切り詰めるため、
          // マークアップを削って同じ窓に入る情報量を増やす。命中経路にも適用する
          // のは、命中したブロックが大きいサイトでも同じ切り詰めを受けるため。
          const compacted = logCompaction(extractedHtml, `セレクタ "${selector}"`);

          // デバッグモード時にHTMLを保存
          await saveHtmlForDebug(compacted, actualUrl, 'content-compacted');

          return { compacted, raw: fullHtml };
        }
      }
    }

    // フォールバック: 外枠を落としたうえで本文らしいブロックを選ぶ
    console.log(`[HTMLExtractor:Content] 🔄 セレクタで見つからないため、本文ブロックを推定`);

    // head から必要な情報を抽出 (除去処理より前に取る)
    const headInfo: string[] = [];
    for (const keepSelector of HEAD_KEEP_SELECTORS) {
      $(keepSelector).each((_, el) => {
        const outerHtml = $.html(el);
        if (outerHtml) {
          headInfo.push(outerHtml);
        }
      });
    }

    // ⚠️ `selectMainContent` は `$` を破壊的に変更する (外枠を remove する)。
    //    head 情報の抽出は上で済ませてあるため、ここで渡してよい。
    //    2 回目の parse を避けるため既存インスタンスを渡す。
    const selection = selectMainContent($);
    console.log(
      `[HTMLExtractor:Content] 本文ブロック: ${selection.strategy}` +
        (selection.selectedElement ? ` (${selection.selectedElement})` : '') +
        // 3 段で出す。外枠除去の効果 (1→2) とブロック選定の効果 (2→3) は原因が別で、
        // 1 つの差分に潰すと「どちらが効いたか」が分からなくなる。
        ` / テキスト ${selection.bodyTextLength.toLocaleString()}` +
        ` → 外枠除去後 ${selection.bodyTextLengthAfterRemoval.toLocaleString()}` +
        ` → 選定後 ${selection.selectedTextLength.toLocaleString()} 文字`
    );

    // ⚠️ 圧縮は body 部分にのみ適用する。head 情報 (`title` / `meta[og:*]`) を
    //    一緒に通すと、属性除去で `meta` の `content` が落ちて og 情報が失われる。
    const bodyContent = logCompaction(selection.html, '本文ブロック');

    // クリーンアップされたHTMLを構築
    const cleanedHtml = `<!-- Head Info -->
${headInfo.join('\n')}

<!-- Body Content -->
${bodyContent}`;

    console.log(
      `[HTMLExtractor:Content] ✅ クリーンアップ完了: ${cleanedHtml.length} bytes (元: ${fullHtml.length} bytes)`
    );

    // HTMLプレビュー（デバッグ用）
    const preview = cleanedHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 300);
    console.log(`[HTMLExtractor:Content] プレビュー: ${preview}...`);

    // デバッグモード時にHTMLを保存
    await saveHtmlForDebug(cleanedHtml, actualUrl, 'content-cleaned');

    return { compacted: cleanedHtml, raw: fullHtml };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(
          `コンテンツHTMLのフェッチがタイムアウトしました: ${url} (${FETCH_TIMEOUT_MS}ms)`
        );
      }
      throw new Error(`コンテンツHTMLの取得に失敗: ${url} - ${error.message}`);
    }
    throw new Error(`コンテンツHTMLの取得に失敗: ${url}`);
  }
}
