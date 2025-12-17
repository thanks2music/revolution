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
 */
const CONTENT_REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
] as const;

/**
 * head 内で保持するセレクタ
 * (extractContentHtml で使用)
 */
const HEAD_KEEP_SELECTORS = [
  'title',
  'meta[name="description"]',
  'meta[property^="og:"]',
] as const;

/**
 * HTMLフェッチのタイムアウト設定（ミリ秒）
 */
const FETCH_TIMEOUT_MS = 10000;

/**
 * ブラウザライクな User-Agent
 * 一部のサイトはボット User-Agent をブロックするため、
 * ブラウザに近い User-Agent を使用する
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
 * デバッグモード時にHTMLをファイルに保存
 *
 * @param html 保存するHTML
 * @param url 元のURL（ファイル名生成に使用）
 */
async function saveHtmlForDebug(html: string, url: string): Promise<void> {
  // 環境変数チェック
  if (process.env.DEBUG_HTML_EXTRACTION !== 'true') {
    return;
  }

  try {
    // debug-logs ディレクトリを作成
    const debugDir = path.join(process.cwd(), 'debug-logs');
    await fs.mkdir(debugDir, { recursive: true });

    // ファイル名生成（タイムスタンプ + URL由来）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const urlSlug = new URL(url).hostname.replace(/\./g, '-');
    const filename = `html-${urlSlug}-${timestamp}.html`;
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
          await saveHtmlForDebug(extractedHtml, actualUrl);

          return extractedHtml;
        } else {
          selectorTrials.push({ selector, found: true, length: 0 });
        }
      } else {
        selectorTrials.push({ selector, found: false });
      }
    }

    // すべてのセレクタで見つからない場合はフォールバック
    console.warn(`[HTMLExtractor] ⚠️  セレクタで要素が見つからないため、完全なHTMLを返します`);
    console.warn(`[HTMLExtractor] セレクタ試行結果: ${JSON.stringify(selectorTrials, null, 2)}`);
    console.warn(`[HTMLExtractor] HTMLプレビュー（最初の1000文字）:\n${html.substring(0, 1000)}`);

    // デバッグモード時にHTMLを保存（フォールバック時も保存）
    await saveHtmlForDebug(html, actualUrl);

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
          await saveHtmlForDebug(articleHtml, actualUrl);
          break;
        }
      }
    }

    // すべてのセレクタで見つからない場合はフォールバック
    if (!articleHtml) {
      console.warn(`[HTMLExtractor] ⚠️  セレクタで要素が見つからないため、完全なHTMLを返します`);
      articleHtml = fullHtml;
      await saveHtmlForDebug(fullHtml, actualUrl);
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
 * 1. まず既存のセレクタ（main, article等）で試行
 * 2. 見つからない場合は body 全体をフォールバック
 * 3. 不要な要素（script, style, noscript等）を除去
 * 4. head から必要な情報（title, meta description, og:*）のみ抽出
 *
 * 保持する要素:
 * - header, nav: 他ページへの参照リンク用
 * - footer: コピーライト情報抽出用
 * - head内: title, meta[name="description"], meta[property^="og:"]
 *
 * @param url 公式サイトURL
 * @returns クリーンアップされたHTML
 * @throws フェッチエラー、タイムアウトエラー
 */
export async function extractContentHtml(url: string): Promise<string> {
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

          // デバッグモード時にHTMLを保存
          await saveHtmlForDebug(extractedHtml, actualUrl);

          return extractedHtml;
        }
      }
    }

    // フォールバック: body 全体を使用し、クリーンアップ
    console.log(`[HTMLExtractor:Content] 🔄 セレクタで見つからないため、body全体を使用`);

    // 不要な要素を除去
    for (const removeSelector of CONTENT_REMOVE_SELECTORS) {
      $(removeSelector).remove();
    }

    // head から必要な情報を抽出
    const headInfo: string[] = [];
    for (const keepSelector of HEAD_KEEP_SELECTORS) {
      $(keepSelector).each((_, el) => {
        const outerHtml = $.html(el);
        if (outerHtml) {
          headInfo.push(outerHtml);
        }
      });
    }

    // body のコンテンツを取得
    const bodyContent = $('body').html() || '';

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
    await saveHtmlForDebug(cleanedHtml, actualUrl);

    return cleanedHtml;
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
