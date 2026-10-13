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
 * (ヒロアカ)、ノベルティの下層ページが無いときは、案内ページの特典の画像を候補に残す (`venueNoveltyImages`)。
 *
 * 2026-10-13: 枚数の上限を廃止した (公式の画像をすべて載せる。BOSS 決定)。歯止めの短辺 (`min_short_side`) は、
 * 取得した後に実際の画素数で当てる (`article-images/process-article-image.ts`)。HTML の width / height は表示の大きさで、
 * 高解像度の画像を小さく並べたグッズの一覧を落としてしまうため使わない。
 * 画像は下層ページの本文ブロックから集め (ヘッダー・ナビの画像を拾わない)、代替テキストも残す
 * (`imageAlts`。品目ごとの画像の照合に使う)。
 */

import * as cheerio from 'cheerio';
import type { CategoryUrls } from '@/lib/types/subpage-detection';
import { expandInertiaPayload } from '@/lib/utils/inertia-payload';
import { selectMainContent } from '@/lib/utils/html-extractor';
import { compactHtmlForLlm, truncateForLlm } from '@/lib/utils/compact-html';
import { mentionsRedrawnIllustration } from '@/lib/utils/redrawn-illustration';
import { pageUrlKey } from '@/lib/utils/url';
import { fetchPageSafely } from '@/lib/utils/safe-image-fetch';
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

/** トップページへの退避で、カテゴリごとに割り振る枚数の目安 (下層ページが 1 つも無いときだけ) */
const TOP_PAGE_FALLBACK_PER_CATEGORY = 5;

/** 下層ページ・会場の案内ページの取得の時間切れ (ms、1 ページあたり) */
const PAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * カテゴリ別画像抽出結果
 */
export interface CategoryImages {
  /**
   * トップページの og:image (相対 URL はページの URL で解決済み)。アイキャッチの第 1 候補。
   * 無いときの代わり (本文の最初の横長の画像 → 最初の画像) は、上げた後の寸法で選ぶ (`article-images/upload-images-for-article.ts`)
   */
  ogImage: string | null;
  /** メニュー画像URL配列 */
  menu: string[];
  /** ノベルティ画像URL配列 */
  novelty: string[];
  /** グッズ画像URL配列 */
  goods: string[];
  /** 各カテゴリの取得元URL */
  sources: {
    ogImage?: string;
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
  /**
   * 会場の案内ページごとの、ノベルティの画像の候補 (本文ブロックの画像のうち、代替テキストが
   * `novelty_alt_keywords` に当たるもの)。どのページの画像を使うかは、下層ページの抽出でノベルティ名が
   * 読めたページから選ぶ (`pickNoveltyImages`)。利用ガイドのような汎用のページの画像を使わないため
   */
  venueNoveltyImages: VenueNoveltyImages[];
  /** 画像の URL → 代替テキスト (下層ページの画像。品目ごとの画像の照合に使う。空の代替テキストは入れない) */
  imageAlts: Record<string, string>;
}

/** 会場の案内ページ 1 つのノベルティの画像の候補 */
export interface VenueNoveltyImages {
  url: string;
  images: string[];
}

/**
 * ページ画像抽出結果
 */
interface PageImagesResult {
  images: string[];
  /** 画像の URL → 代替テキスト */
  alts: Record<string, string>;
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
 * ページの og:image (無ければ twitter:image)。相対 URL (`/img/ogp.jpg`) はページの URL で解決する。
 * `<head>` を含む HTML を渡す (本文だけに絞った HTML には meta が無い)
 */
export function extractOgImageUrl(html: string | cheerio.CheerioAPI, pageUrl: string): string | null {
  const $ = typeof html === 'string' ? cheerio.load(html) : html;
  const content =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="og:image"]').attr('content') ||
    $('meta[property="twitter:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content');
  if (!content) return null;
  try {
    return new URL(content.trim(), pageUrl).href;
  } catch {
    return null;
  }
}

/**
 * img の画像の URL。遅延読み込みのサイトは src に 1×1 のダミー (`data:image/gif;base64,…`) を置き、
 * 本物を data-src / data-lazy-src に持つので、data: でないものを使う (conan-cafe.jp)。data: しか無ければ画像として扱わない
 */
function imageSource(element: { attr(name: string): string | undefined }): string | undefined {
  const candidates = [element.attr('src'), element.attr('data-src'), element.attr('data-lazy-src')]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  return candidates.find((value) => !/^data:/i.test(value));
}

/**
 * 本文ブロックの画像のうち、代替テキストが語のどれかを含むものの絶対 URL (Layer 1)。
 * 除外パターンは当てない (代替テキストが根拠になるため)。短辺の下限は、上げる前に実際の画素数で当てる
 * (代替テキストが「特典」の小さなアイコンはそこで落ちる)。語が無ければ空
 */
export function findImagesByAlt(html: string, sourceUrl: string, keywords: readonly string[]): string[] {
  if (keywords.length === 0) return [];
  const $ = cheerio.load(html);
  const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const images: string[] = [];
  $('img').each((_, element) => {
    const alt = ($(element).attr('alt') ?? '').toLowerCase();
    if (!lowerKeywords.some((keyword) => alt.includes(keyword))) return;
    const src = imageSource($(element));
    if (!src) return;
    try {
      const absoluteUrl = new URL(src, sourceUrl).href;
      if (!images.includes(absoluteUrl)) images.push(absoluteUrl);
    } catch {
      // URL として読めない src は飛ばす
    }
  });
  return images;
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
      ogImage: null,
      menu: [],
      novelty: [],
      goods: [],
      sources: {},
      all: [],
      mentionsRedrawnIllustration: false,
      pages: [],
      venueNoveltyImages: [],
      imageAlts: {},
    };

    const allImages = new Set<string>();

    // 1. トップページからOGP画像とアイキャッチを取得
    if (topPageHtml) {
      const topPageResult = this.extractImagesFromHtml(
        topPageHtml,
        topPageUrl,
        imageConfig
      );
      result.ogImage = topPageResult.ogpImage;
      result.sources.ogImage = topPageUrl;

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
          const mainHtml = this.addPageText(result, targetUrl, category, html);
          // 本文ブロックの画像を使う (ヘッダー・ナビの画像を拾わない)。本文ブロックに画像が無ければページ全体から
          const mainResult = this.extractImagesFromHtml(mainHtml, targetUrl, imageConfig);
          const pageResult =
            mainResult.images.length > 0 ? mainResult : this.extractImagesFromHtml(html, targetUrl, imageConfig);
          if (pageResult.excluded.length > 0) {
            console.log(
              `[CategoryImageExtractor] ${category}: 除外パターンで ${pageResult.excluded.length}枚を除外 (例: ${pageResult.excluded.slice(0, 3).join(', ')})`
            );
          }

          // 枚数の上限は設けない (短辺の判定は取得してから行う)
          result[category] = pageResult.images;
          result.sources[category] = targetUrl;
          Object.assign(result.imageAlts, pageResult.alts);
          pageResult.images.forEach((img) => allImages.add(img));

          console.log(
            `[CategoryImageExtractor] ${category}: ${pageResult.images.length}枚の画像を抽出`
          );
        } catch (error) {
          console.warn(
            `[CategoryImageExtractor] ${category}: ページ取得失敗 (${targetUrl})`,
            error
          );
        }
      }
    }

    // 2.5 会場ごとの案内ページ。本文と、ノベルティの画像の候補 (代替テキストで選ぶ) を残す
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
    for (const venue of venueHtmls) {
      if (!venue) continue;
      const mainHtml = this.addPageText(result, venue.url, 'venue', venue.html);
      const images = findImagesByAlt(mainHtml, venue.url, imageConfig.novelty_alt_keywords ?? []);
      if (images.length > 0) result.venueNoveltyImages.push({ url: venue.url, images });
    }
    if (venues.length > 0 && (imageConfig.novelty_alt_keywords ?? []).length === 0) {
      // Templates の設定 (store-url-patterns.yaml) が古いと、ノベルティの画像を黙って選ばなくなる
      console.warn(
        '[CategoryImageExtractor] ⚠️ novelty_alt_keywords が未設定のため、会場のページからノベルティの画像を選べない (pnpm sync:templates を確認)'
      );
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

      // ヒューリスティックに分割（既存ロジックと同様）。渡されるトップページは圧縮後の HTML (<img> が残らない) で、
      // この経路は実際にはほぼ 0 枚になる (SoT §3.4)。枚数の上限の廃止とは別に、分け方の目安として 5 枚ずつにする
      const images = topPageResult.images;
      const maxPerCategory = TOP_PAGE_FALLBACK_PER_CATEGORY;

      result.menu = images.slice(0, maxPerCategory);
      result.novelty = images.slice(maxPerCategory, maxPerCategory * 2);
      result.goods = images.slice(maxPerCategory * 2, maxPerCategory * 3);

      result.sources.menu = topPageUrl;
      result.sources.novelty = topPageUrl;
      result.sources.goods = topPageUrl;

      images.forEach((img) => allImages.add(img));
    }

    result.all = Array.from(allImages);

    console.log('[CategoryImageExtractor] 抽出結果:', {
      ogImage: result.ogImage ? '取得済み' : 'なし',
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
    // URL は記事選別の応答やトップページのリンク由来なので、画像と同じ SSRF ガードを通す
    // (内部アドレス・リダイレクトの各ホップ・本文の大きさ)。1 ページの取得が止まっても、記事の生成全体を止めない
    return fetchPageSafely(url, {
      timeoutMs: PAGE_FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });
  }

  /**
   * HTMLから画像を抽出
   */
  private extractImagesFromHtml(
    html: string,
    sourceUrl: string,
    config: { exclude_patterns: string[] }
  ): PageImagesResult {
    const $ = cheerio.load(html);

    // OGP画像を取得
    const ogpImage = extractOgImageUrl($, sourceUrl);

    // 記事内の画像を全て取得
    const images: string[] = [];
    const alts: Record<string, string> = {};
    const excluded: string[] = [];
    const excludeRegex = new RegExp(config.exclude_patterns.join('|'), 'i');

    $('img').each((_, element) => {
      const src = imageSource($(element));

      if (!src) return;

      // 絶対URLに変換
      let absoluteUrl: string;
      let pathAndQuery: string;
      try {
        // 相対パスはページの URL で解決する (サイトの先頭で解決すると img/a.jpg が /img/a.jpg になる)
        absoluteUrl = new URL(src, sourceUrl).href;
        pathAndQuery = toExcludeTarget(new URL(absoluteUrl));
      } catch {
        return;
      }

      // 除外パターンチェック
      if (excludeRegex.test(pathAndQuery)) {
        excluded.push(pathAndQuery);
        return;
      }

      // 重複チェック
      if (!images.includes(absoluteUrl)) {
        images.push(absoluteUrl);
        const alt = ($(element).attr('alt') ?? '').trim();
        if (alt) alts[absoluteUrl] = alt;
      }
    });

    return { images, alts, ogpImage, excluded };
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
