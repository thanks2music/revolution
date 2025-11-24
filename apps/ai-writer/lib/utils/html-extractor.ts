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
 * HTMLフェッチのタイムアウト設定（ミリ秒）
 */
const FETCH_TIMEOUT_MS = 10000;

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

    const response = await fetch(actualUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; RevolutionBot/1.0; +https://revolution.example.com/bot)',
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

    const response = await fetch(actualUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; RevolutionBot/1.0; +https://revolution.example.com/bot)',
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
