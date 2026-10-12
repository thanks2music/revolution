/**
 * Category Image Extractor Service
 * カテゴリ別に画像を抽出するサービス
 *
 * @description
 * SubpageDetectorService で検出されたカテゴリ別URLから
 * 各ページの画像を抽出し、カテゴリごとに整理して返す。
 *
 * 取得したページの本文 (本文ブロックを圧縮した文字) も `pages` に残し、下層ページの抽出
 * (`subpage-extraction`) に渡す (2026-10-12。追加の通信をしないため、ここで取得したものを使う)。
 * 会場ごとの案内ページ (`venueUrls`) も取得する。ノベルティが案内ページにしか無いサイトがあるため
 * (ヒロアカ)、ノベルティの下層ページが無いときは、最初の案内ページの画像をノベルティの画像にする。
 */

import * as cheerio from 'cheerio';
import type { CategoryUrls } from '@/lib/types/subpage-detection';
import { expandInertiaPayload } from '@/lib/utils/inertia-payload';
import { selectMainContent } from '@/lib/utils/html-extractor';
import { compactHtmlForLlm, truncateForLlm } from '@/lib/utils/compact-html';
import { mentionsRedrawnIllustration } from '@/lib/utils/redrawn-illustration';
import { pageUrlKey } from '@/lib/utils/url';
import { getConfigLoaderService, ConfigLoaderService } from './config-loader.service';

/** 下層ページの種類。venue は会場ごとの案内ページ */
export type SubpageKind = 'menu' | 'novelty' | 'goods' | 'venue';

/** 取得した下層ページの本文 (本文ブロックを圧縮したもの。画像は「[画像: 代替テキスト]」) */
export interface SubpageText {
  url: string;
  kind: SubpageKind;
  text: string;
}

/** 1 ページの本文の上限 (文字)。全体の上限は下層ページの抽出が受け持つ */
export const SUBPAGE_TEXT_BUDGET_CHARS = 20_000;

/** 取得する会場の案内ページの上限 */
export const MAX_VENUE_PAGES = 10;

/** 下層ページ・会場の案内ページの取得の時間切れ (ms、1 ページあたり) */
const PAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * カテゴリ別画像抽出結果
 */
export interface CategoryImages {
  /** アイキャッチ画像URL（OGP画像 or トップページの最初の画像） */
  eyecatch: string | null;
  /** メニュー画像URL配列 */
  menu: string[];
  /** ノベルティ画像URL配列 */
  novelty: string[];
  /** グッズ画像URL配列 */
  goods: string[];
  /** 各カテゴリの取得元URL */
  sources: {
    eyecatch?: string;
    menu?: string;
    novelty?: string;
    goods?: string;
  };
  /** 全画像URL（重複排除済み） */
  all: string[];
  /**
   * 取得した下層ページのどれかの本文ブロックに「描き下ろし」「描き起こし」の記載があったか。
   * キャラクター名を Vision と HTML で足し合わせるかの判定に使う (画像の抽出で取得したページを
   * そのまま調べ、追加の通信はしない。HTML 自体は結果に残さない)
   */
  mentionsRedrawnIllustration: boolean;
  /** 取得した下層ページと会場の案内ページの本文 (取得に失敗したページは含まない) */
  pages: SubpageText[];
}

/**
 * ページ画像抽出結果
 */
interface PageImagesResult {
  images: string[];
  ogpImage: string | null;
  /** 除外パターンに当たって捨てた画像の、パスとクエリ (原因を追えるようにログへ出す) */
  excluded: string[];
}

/**
 * 除外パターンを当てる文字列。ホスト名は含めず (`line` が images.ltr-online.com に当たり
 * 全画像が落ちていた)、パスとクエリを使う。画像プロキシ (`/_next/image?url=%2Fimages%2Flogo.png`)
 * のファイル名も見えるよう、クエリはデコードする。
 */
function toExcludeTarget(url: URL): string {
  try {
    return `${url.pathname}${decodeURIComponent(url.search)}`;
  } catch {
    return `${url.pathname}${url.search}`;
  }
}

/**
 * Category Image Extractor Service
 */
export class CategoryImageExtractorService {
  private configLoader: ConfigLoaderService;

  constructor(configLoader?: ConfigLoaderService) {
    this.configLoader = configLoader || getConfigLoaderService();
  }

  /**
   * カテゴリ別に画像を抽出
   *
   * @param topPageUrl トップページURL（フォールバック & OGP取得用）
   * @param topPageHtml トップページのHTML（既に取得済みの場合）
   * @param categoryUrls カテゴリ別URLマップ（SubpageDetectorService の出力）
   * @param venueUrls 会場ごとの案内ページ (記事選別の公式 URL のうち、トップと同じサイトのもの)
   * @returns カテゴリ別画像
   */
  async extractCategoryImages(
    topPageUrl: string,
    topPageHtml: string | null,
    categoryUrls: CategoryUrls,
    venueUrls: string[] = []
  ): Promise<CategoryImages> {
    console.log('[CategoryImageExtractor] カテゴリ別画像抽出開始');

    // 設定を読み込み
    const config = await this.configLoader.loadStoreUrlPatterns();
    const imageConfig = config.image_extraction;

    const result: CategoryImages = {
      eyecatch: null,
      menu: [],
      novelty: [],
      goods: [],
      sources: {},
      all: [],
      mentionsRedrawnIllustration: false,
      pages: [],
    };

    const allImages = new Set<string>();

    // 1. トップページからOGP画像とアイキャッチを取得
    if (topPageHtml) {
      const topPageResult = this.extractImagesFromHtml(
        topPageHtml,
        topPageUrl,
        imageConfig
      );
      result.eyecatch = topPageResult.ogpImage || topPageResult.images[0] || null;
      result.sources.eyecatch = topPageUrl;

      // トップページの画像を all に追加
      topPageResult.images.forEach((img) => allImages.add(img));
    }

    // 2. 各カテゴリの下層ページから画像を抽出
    const categories = ['menu', 'novelty', 'goods'] as const;

    for (const category of categories) {
      const urls = categoryUrls[category];

      if (urls && urls.length > 0) {
        // 最初のURLのみを使用（複数ある場合）
        const targetUrl = urls[0];

        try {
          console.log(`[CategoryImageExtractor] ${category}: ${targetUrl} から画像抽出`);

          // Inertia.js のサイトは画像を <img> ではなく data-page の JSON に持つため展開する
          const html = expandInertiaPayload(await this.fetchPage(targetUrl));
          this.addPageText(result, targetUrl, category, html);
          const pageResult = this.extractImagesFromHtml(html, targetUrl, imageConfig);
          if (pageResult.excluded.length > 0) {
            console.log(
              `[CategoryImageExtractor] ${category}: 除外パターンで ${pageResult.excluded.length}枚を除外 (例: ${pageResult.excluded.slice(0, 3).join(', ')})`
            );
          }

          // 最大枚数まで取得
          const limitedImages = pageResult.images.slice(
            0,
            imageConfig.max_images_per_category
          );

          result[category] = limitedImages;
          result.sources[category] = targetUrl;

          // all に追加
          limitedImages.forEach((img) => allImages.add(img));

          console.log(
            `[CategoryImageExtractor] ${category}: ${limitedImages.length}枚の画像を抽出`
          );
        } catch (error) {
          console.warn(
            `[CategoryImageExtractor] ${category}: ページ取得失敗 (${targetUrl})`,
            error
          );
        }
      }
    }

    // 2.5 会場ごとの案内ページ。本文を残し、ノベルティの画像が無ければ最初のページの本文ブロックの画像を使う
    const fetchedKeys = new Set([topPageUrl, ...Object.values(result.sources)].map(pageUrlKey));
    const venues = Array.from(new Set(venueUrls))
      .filter((url) => !fetchedKeys.has(pageUrlKey(url)))
      .slice(0, MAX_VENUE_PAGES);
    const venueHtmls = await Promise.all(
      venues.map(async (url) => {
        try {
          return { url, html: expandInertiaPayload(await this.fetchPage(url)) };
        } catch (error) {
          console.warn(`[CategoryImageExtractor] venue: ページ取得失敗 (${url})`, error);
          return null;
        }
      })
    );
    const venueMainHtmls: Array<{ url: string; mainHtml: string }> = [];
    for (const venue of venueHtmls) {
      if (!venue) continue;
      venueMainHtmls.push({ url: venue.url, mainHtml: this.addPageText(result, venue.url, 'venue', venue.html) });
    }
    if (venues.length > 0) {
      console.log(
        `[CategoryImageExtractor] venue: 案内ページ ${venueHtmls.filter(Boolean).length}/${venues.length} 件の本文を取得`
      );
    }

    // 3. 下層ページがない場合はトップページから推測（フォールバック）
    if (
      result.menu.length === 0 &&
      result.novelty.length === 0 &&
      result.goods.length === 0 &&
      topPageHtml
    ) {
      console.log('[CategoryImageExtractor] 下層ページなし、トップページからフォールバック');

      const topPageResult = this.extractImagesFromHtml(
        topPageHtml,
        topPageUrl,
        imageConfig
      );

      // ヒューリスティックに分割（既存ロジックと同様）
      const images = topPageResult.images;
      const maxPerCategory = imageConfig.max_images_per_category;

      result.menu = images.slice(0, maxPerCategory);
      result.novelty = images.slice(maxPerCategory, maxPerCategory * 2);
      result.goods = images.slice(maxPerCategory * 2, maxPerCategory * 3);

      result.sources.menu = topPageUrl;
      result.sources.novelty = topPageUrl;
      result.sources.goods = topPageUrl;

      images.forEach((img) => allImages.add(img));
    }

    // 4. ノベルティの画像がまだ無ければ、最初に画像のある会場の案内ページの本文ブロックの画像を使う
    //    (トップページへの退避 (3) より後に行う。先に埋めると、3 の「3 カテゴリとも空」の条件が崩れる)
    if (result.novelty.length === 0) {
      for (const venue of venueMainHtmls) {
        // ヘッダーのロゴを拾わないよう、本文ブロックの画像だけを使う
        const images = this.extractImagesFromHtml(venue.mainHtml, venue.url, imageConfig).images.slice(
          0,
          imageConfig.max_images_per_category
        );
        if (images.length === 0) continue;
        result.novelty = images;
        result.sources.novelty = venue.url;
        images.forEach((img) => allImages.add(img));
        console.log(`[CategoryImageExtractor] novelty: 会場の案内ページ ${venue.url} から ${images.length}枚`);
        break;
      }
    }

    result.all = Array.from(allImages);

    console.log('[CategoryImageExtractor] 抽出結果:', {
      eyecatch: result.eyecatch ? '取得済み' : 'なし',
      menu: result.menu.length,
      novelty: result.novelty.length,
      goods: result.goods.length,
      total: result.all.length,
    });

    return result;
  }

  /**
   * 本文ブロックを切り出して `pages` に残し、「描き下ろし」の記載も調べる。本文ブロックの HTML を返す
   */
  private addPageText(result: CategoryImages, url: string, kind: SubpageKind, html: string): string {
    // ナビ・フッター・関連ニュースの欄を除いた本文ブロックだけを使う
    const mainHtml = selectMainContent(cheerio.load(html)).html;
    result.mentionsRedrawnIllustration ||= mentionsRedrawnIllustration(mainHtml);
    const { text } = truncateForLlm(compactHtmlForLlm(mainHtml).html, SUBPAGE_TEXT_BUDGET_CHARS);
    result.pages.push({ url, kind, text });
    return mainHtml;
  }

  /**
   * ページをフェッチ
   */
  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      // 1 ページの取得が止まっても、記事の生成全体を止めない
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * HTMLから画像を抽出
   */
  private extractImagesFromHtml(
    html: string,
    sourceUrl: string,
    config: {
      max_images_per_category: number;
      min_image_size: { width: number; height: number };
      exclude_patterns: string[];
    }
  ): PageImagesResult {
    const $ = cheerio.load(html);
    const baseUrl = new URL(sourceUrl);

    // OGP画像を取得
    const ogpImage = this.extractOgpImage($);

    // 記事内の画像を全て取得
    const images: string[] = [];
    const excluded: string[] = [];
    const excludeRegex = new RegExp(config.exclude_patterns.join('|'), 'i');

    $('img').each((_, element) => {
      const src =
        $(element).attr('src') ||
        $(element).attr('data-src') ||
        $(element).attr('data-lazy-src');

      if (!src) return;

      // 絶対URLに変換
      let absoluteUrl: string;
      let pathAndQuery: string;
      try {
        absoluteUrl = new URL(src, baseUrl.origin).href;
        pathAndQuery = toExcludeTarget(new URL(absoluteUrl));
      } catch {
        return;
      }

      // 除外パターンチェック
      if (excludeRegex.test(pathAndQuery)) {
        excluded.push(pathAndQuery);
        return;
      }

      // サイズフィルタ
      const width = $(element).attr('width');
      const height = $(element).attr('height');

      if (width && height) {
        const w = parseInt(width, 10);
        const h = parseInt(height, 10);

        if (w < config.min_image_size.width || h < config.min_image_size.height) {
          return;
        }
      }

      // 重複チェック
      if (!images.includes(absoluteUrl)) {
        images.push(absoluteUrl);
      }
    });

    return { images, ogpImage, excluded };
  }

  /**
   * OGP画像を抽出
   */
  private extractOgpImage($: cheerio.CheerioAPI): string | null {
    const ogpImage =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content') ||
      $('meta[property="twitter:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content');

    return ogpImage || null;
  }
}

/**
 * シングルトンインスタンス（遅延初期化）
 */
let _categoryImageExtractorService: CategoryImageExtractorService | null = null;

export function getCategoryImageExtractorService(): CategoryImageExtractorService {
  if (!_categoryImageExtractorService) {
    _categoryImageExtractorService = new CategoryImageExtractorService();
  }
  return _categoryImageExtractorService;
}
