/**
 * Subpage Detector Service
 * 特設サイトの下層ページを検出し、カテゴリ別URLを抽出するサービス
 *
 * @description
 * 検出優先度:
 *   1. YAML設定（店舗固有パターン）
 *   2. キーワードマッチング（default_patterns）
 *   3. AI判定（ai_fallback）
 *   4. none（トップページのみ使用）
 */

import type {
  CategoryType,
  CategoryUrls,
  DetectionMethod,
  SubpageDetectionResult,
  StorePatternConfig,
} from '@/lib/types/subpage-detection';
import { getConfigLoaderService, ConfigLoaderService } from './config-loader.service';

// 型を再エクスポート（パイプラインから利用するため）
export type { SubpageDetectionResult, CategoryUrls, DetectionMethod };
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';

/**
 * Subpage Detector Service
 */
export class SubpageDetectorService {
  private configLoader: ConfigLoaderService;
  private aiProvider: AiProvider;

  constructor(configLoader?: ConfigLoaderService, aiProvider?: AiProvider) {
    this.configLoader = configLoader || getConfigLoaderService();
    this.aiProvider = aiProvider || createAiProvider();
  }

  /**
   * 特設サイトの下層ページを検出
   *
   * @param topPageUrl トップページURL
   * @param storeName 店舗名（YAML検索用）
   * @param pageLinks トップページから抽出したリンク一覧
   * @returns 検出結果
   */
  async detectSubpages(
    topPageUrl: string,
    storeName: string,
    pageLinks: string[]
  ): Promise<SubpageDetectionResult> {
    console.log('[SubpageDetector] 下層ページ検出開始:', { topPageUrl, storeName });

    // 設定を読み込み
    const config = await this.configLoader.loadStoreUrlPatterns();

    // 店舗名からスラッグを解決
    const storeSlug = await this.configLoader.resolveStoreSlug(storeName);
    console.log('[SubpageDetector] 店舗スラッグ:', storeSlug || '(未登録)');

    // ベースURLを抽出（相対URLを絶対URLに変換するため）
    const baseUrl = new URL(topPageUrl).origin;

    // リンクを正規化（絶対URLに変換）
    const normalizedLinks = this.normalizeLinks(pageLinks, baseUrl);

    // 結果を初期化
    const result: SubpageDetectionResult = {
      categoryUrls: {},
      detectionMethods: {},
      isTopPageOnly: true,
      _debug: {
        storeSlug: storeSlug || undefined,
        availableLinks: normalizedLinks,
      },
    };

    // カテゴリごとに検出
    const categories: CategoryType[] = ['menu', 'novelty', 'goods'];

    for (const category of categories) {
      const detected = await this.detectCategoryUrls(
        category,
        storeSlug,
        normalizedLinks,
        config,
        baseUrl
      );

      if (detected.urls.length > 0) {
        result.categoryUrls[category] = detected.urls;
        result.detectionMethods[category] = detected.method;
        result.isTopPageOnly = false;
      }
    }

    console.log('[SubpageDetector] 検出結果:', {
      menu: result.categoryUrls.menu?.length || 0,
      novelty: result.categoryUrls.novelty?.length || 0,
      goods: result.categoryUrls.goods?.length || 0,
      isTopPageOnly: result.isTopPageOnly,
    });

    return result;
  }

  /**
   * カテゴリ別URLを検出
   */
  private async detectCategoryUrls(
    category: CategoryType,
    storeSlug: string | null,
    links: string[],
    config: Awaited<ReturnType<ConfigLoaderService['loadStoreUrlPatterns']>>,
    baseUrl: string
  ): Promise<{ urls: string[]; method: DetectionMethod }> {
    // 1. YAML設定で検出
    if (storeSlug && config.stores[storeSlug]?.[category]) {
      const storePattern = config.stores[storeSlug][category] as StorePatternConfig;
      const yamlUrls = this.detectByYamlPattern(links, storePattern, baseUrl);

      if (yamlUrls.length > 0) {
        console.log(`[SubpageDetector] ${category}: YAML設定で検出 (${yamlUrls.length}件)`);
        return { urls: yamlUrls, method: 'yaml' };
      }
    }

    // 2. キーワードマッチングで検出
    const defaultPattern = config.default_patterns[category];
    const keywordUrls = this.detectByKeyword(links, defaultPattern);

    if (keywordUrls.length > 0) {
      console.log(`[SubpageDetector] ${category}: キーワードで検出 (${keywordUrls.length}件)`);
      return { urls: keywordUrls, method: 'keyword' };
    }

    // 3. AI判定で検出（フォールバック）
    if (config.ai_fallback.enabled && links.length > 0) {
      const aiUrls = await this.detectByAi(category, links, config.ai_fallback.prompt_template);

      if (aiUrls.length > 0) {
        console.log(`[SubpageDetector] ${category}: AI判定で検出 (${aiUrls.length}件)`);
        return { urls: aiUrls, method: 'ai' };
      }
    }

    // 4. 検出なし
    return { urls: [], method: 'none' };
  }

  /**
   * YAMLパターンで検出
   */
  private detectByYamlPattern(
    links: string[],
    pattern: StorePatternConfig,
    baseUrl: string
  ): string[] {
    const matchedUrls: string[] = [];

    if (pattern.type === 'store_page') {
      // 店舗ページタイプ: パターンからURLを生成して検索
      const patternBase = pattern.pattern.replace('/{location}', '');

      // パターンにマッチするリンクを抽出
      const matchingLinks = links.filter((link) => {
        const path = new URL(link).pathname;
        return path.startsWith(patternBase);
      });

      if (matchingLinks.length === 0) {
        return [];
      }

      // 優先ロケーションで検索
      if (pattern.priority_locations) {
        for (const location of pattern.priority_locations) {
          const priorityPattern = pattern.pattern.replace('{location}', location);
          const found = matchingLinks.find((link) => {
            const path = new URL(link).pathname;
            return path === priorityPattern || path.includes(`/${location}`);
          });

          if (found) {
            matchedUrls.push(found);
            return matchedUrls;
          }
        }
      }

      // フォールバック: 最初の一致を使用
      if (pattern.fallback === 'first_available' && matchingLinks.length > 0) {
        matchedUrls.push(matchingLinks[0]);
      }
    } else if (pattern.type === 'subpage') {
      // 通常の下層ページ: パターンに直接マッチ
      const targetPath = pattern.pattern;
      const found = links.find((link) => {
        const path = new URL(link).pathname;
        return path === targetPath || path.startsWith(targetPath);
      });

      if (found) {
        matchedUrls.push(found);
      }
    }

    return matchedUrls;
  }

  /**
   * キーワードマッチングで検出
   */
  private detectByKeyword(
    links: string[],
    pattern: { keywords: string[]; exclude_keywords?: string[] }
  ): string[] {
    const matchedUrls: string[] = [];

    for (const link of links) {
      const path = new URL(link).pathname.toLowerCase();

      // 除外キーワードチェック
      if (pattern.exclude_keywords) {
        const isExcluded = pattern.exclude_keywords.some((keyword) =>
          path.includes(keyword.toLowerCase())
        );
        if (isExcluded) {
          continue;
        }
      }

      // キーワードマッチ
      const isMatched = pattern.keywords.some((keyword) =>
        path.includes(keyword.toLowerCase())
      );

      if (isMatched) {
        matchedUrls.push(link);
      }
    }

    return matchedUrls;
  }

  /**
   * AI判定で検出（フォールバック）
   */
  private async detectByAi(
    category: CategoryType,
    links: string[],
    promptTemplate: string
  ): Promise<string[]> {
    try {
      // プロンプトを構築
      const urlList = links.map((url) => `- ${url}`).join('\n');
      const prompt = promptTemplate
        .replace('{category}', category)
        .replace('{url_list}', urlList);

      // AI APIを呼び出し
      const response = await this.aiProvider.sendMessage(prompt, {
        maxTokens: 500,
        temperature: 0.3,
        responseFormat: 'json',
      });

      // レスポンスをパース
      const parsed = this.parseAiResponse(response.content);

      // 元のリンクリストに含まれるURLのみを返す（ハルシネーション防止）
      const validUrls = parsed.filter((url) => links.includes(url));

      if (process.env.DEBUG_SUBPAGE_DETECTION === 'true') {
        console.log(`[SubpageDetector] AI判定結果 (${category}):`, {
          suggested: parsed,
          valid: validUrls,
        });
      }

      return validUrls;
    } catch (error) {
      console.warn('[SubpageDetector] AI判定エラー:', error);
      return [];
    }
  }

  /**
   * AI レスポンスをパース
   */
  private parseAiResponse(response: string): string[] {
    let content = response.trim();

    // マークダウンコードブロックを除去
    const codeBlockMatch = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(content);

      if (Array.isArray(parsed.matched_urls)) {
        return parsed.matched_urls;
      }

      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      console.warn('[SubpageDetector] AI レスポンスのパース失敗');
    }

    return [];
  }

  /**
   * リンクを正規化（絶対URLに変換）
   */
  private normalizeLinks(links: string[], baseUrl: string): string[] {
    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const link of links) {
      try {
        // 絶対URLに変換
        const absoluteUrl = link.startsWith('http')
          ? link
          : new URL(link, baseUrl).href;

        // 同一ドメインのみ
        const linkHost = new URL(absoluteUrl).host;
        const baseHost = new URL(baseUrl).host;

        if (linkHost !== baseHost) {
          continue;
        }

        // 重複排除
        if (seen.has(absoluteUrl)) {
          continue;
        }

        // フラグメント（#）やクエリパラメータを除去した正規化
        const urlObj = new URL(absoluteUrl);
        const cleanUrl = `${urlObj.origin}${urlObj.pathname}`;

        if (!seen.has(cleanUrl)) {
          seen.add(cleanUrl);
          normalized.push(cleanUrl);
        }
      } catch {
        // 無効なURLはスキップ
      }
    }

    return normalized;
  }
}

/**
 * シングルトンインスタンス（遅延初期化）
 */
let _subpageDetectorService: SubpageDetectorService | null = null;

export function getSubpageDetectorService(): SubpageDetectorService {
  if (!_subpageDetectorService) {
    _subpageDetectorService = new SubpageDetectorService();
  }
  return _subpageDetectorService;
}
