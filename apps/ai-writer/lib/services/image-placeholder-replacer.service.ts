/**
 * ImagePlaceholderReplacerService
 *
 * MDXコンテンツ内の画像プレースホルダーをR2画像URLで置換するサービス
 *
 * @description
 * MDX記事生成パイプラインのStep 5.7で使用します。
 * - カテゴリ別画像（menu/novelty/goods）のプレースホルダーを置換
 * - 画像がないカテゴリはセクションごと削除
 *
 * @see /notes/01-project-docs/05-ai-writer/mdx/AI-Writer-MDX-下層ページ検出とカテゴリ別画像取得の実装方針案v0.md
 */

/**
 * プレースホルダー定義
 */
export const PLACEHOLDERS = {
  menu: '{ここにメニューの画像を入れる}',
  novelty: '{ここにノベルティの画像を入れる}',
  goods: '{ここにグッズの画像を入れる}',
  eyecatch: '{ここに記事アイキャッチの画像を入れる}',
} as const;

/**
 * カテゴリ別R2画像URL
 */
export interface CategoryR2Images {
  /** メニュー画像のR2 URL配列 */
  menu: string[];
  /** ノベルティ画像のR2 URL配列 */
  novelty: string[];
  /** グッズ画像のR2 URL配列 */
  goods: string[];
  /** アイキャッチ画像のR2 URL（単一、オプション） */
  eyecatch?: string;
}

/**
 * プレースホルダー置換結果
 */
export interface PlaceholderReplacementResult {
  /** 置換後のコンテンツ */
  content: string;
  /** 置換された画像数 */
  replacedCount: {
    menu: number;
    novelty: number;
    goods: number;
    eyecatch: number;
    total: number;
  };
  /** 削除されたセクション */
  removedSections: ('menu' | 'novelty' | 'goods')[];
  /** 未置換のプレースホルダー（警告用） */
  unreplacedPlaceholders: string[];
}

/**
 * 画像プレースホルダー置換サービス
 */
export class ImagePlaceholderReplacerService {
  /**
   * プレースホルダーをR2画像URLで置換
   *
   * @param content MDXコンテンツ
   * @param images カテゴリ別R2画像URL
   * @param articleTitle 記事タイトル（alt属性に使用）
   * @returns 置換結果
   */
  replaceAll(
    content: string,
    images: CategoryR2Images,
    articleTitle?: string
  ): PlaceholderReplacementResult {
    let result = content;
    const replacedCount = { menu: 0, novelty: 0, goods: 0, eyecatch: 0, total: 0 };
    const removedSections: ('menu' | 'novelty' | 'goods')[] = [];
    const unreplacedPlaceholders: string[] = [];

    // アイキャッチ画像のプレースホルダーを置換（単一画像）
    if (images.eyecatch) {
      const eyecatchPlaceholder = PLACEHOLDERS.eyecatch;
      if (result.includes(eyecatchPlaceholder)) {
        // alt属性: 記事タイトルがあれば使用、なければ「アイキャッチ」
        const eyecatchAlt = articleTitle ? `${articleTitle} アイキャッチ` : 'アイキャッチ';
        const imageMarkdown = `![${eyecatchAlt}](${images.eyecatch})`;
        result = result.replace(eyecatchPlaceholder, imageMarkdown);
        replacedCount.eyecatch = 1;
        replacedCount.total += 1;
        console.log(`[ImagePlaceholderReplacer] eyecatch: 画像で置換`);
      }
    }

    // 各カテゴリのプレースホルダーを置換
    for (const category of ['menu', 'novelty', 'goods'] as const) {
      const placeholder = PLACEHOLDERS[category];
      const urls = images[category];

      if (urls.length > 0) {
        // 画像がある場合: マークダウン画像に置換
        const imageMarkdown = this.generateImageMarkdown(urls, category, articleTitle);
        result = result.replace(placeholder, imageMarkdown);
        replacedCount[category] = urls.length;
        replacedCount.total += urls.length;
        console.log(`[ImagePlaceholderReplacer] ${category}: ${urls.length}件の画像で置換`);
      } else {
        // 画像がない場合: セクションごと削除
        const sectionRemoved = this.removeSectionContaining(result, placeholder, category);
        if (sectionRemoved.removed) {
          result = sectionRemoved.content;
          removedSections.push(category);
          console.log(`[ImagePlaceholderReplacer] ${category}: セクション削除（画像なし）`);
        } else if (result.includes(placeholder)) {
          // セクション削除に失敗したがプレースホルダーが残っている
          unreplacedPlaceholders.push(placeholder);
          console.warn(`[ImagePlaceholderReplacer] ⚠️ ${category}: プレースホルダー未置換`);
        }
      }
    }

    // 未置換プレースホルダーの検出（{{...}} 形式）
    const remainingPlaceholders = result.match(/\{[^{}]+\}/g) || [];
    const imagePlaceholders = remainingPlaceholders.filter((p) =>
      p.includes('画像') || p.includes('ここに')
    );
    if (imagePlaceholders.length > 0) {
      unreplacedPlaceholders.push(...imagePlaceholders);
    }

    return {
      content: result,
      replacedCount,
      removedSections,
      unreplacedPlaceholders,
    };
  }

  /**
   * 画像URLからマークダウン形式の画像リストを生成
   *
   * @param urls 画像URL配列
   * @param category カテゴリ名
   * @param articleTitle 記事タイトル（alt属性に使用）
   * @returns マークダウン形式の画像
   */
  private generateImageMarkdown(
    urls: string[],
    category: string,
    articleTitle?: string
  ): string {
    const categoryLabel = this.getCategoryLabel(category);

    // 複数画像の場合は縦に並べる
    // alt属性形式: 「{記事タイトル} {カテゴリラベル}{番号}」
    // 例: 「機動戦士ガンダム 鉄血のオルフェンズ コラボメニュー1」
    return urls
      .map((url, index) => {
        const altText = articleTitle
          ? `${articleTitle} ${categoryLabel}${index + 1}`
          : `${categoryLabel}${index + 1}`;
        return `![${altText}](${url})`;
      })
      .join('\n\n');
  }

  /**
   * カテゴリに応じたラベルを取得
   */
  private getCategoryLabel(category: string): string {
    switch (category) {
      case 'menu':
        return 'コラボメニュー';
      case 'novelty':
        return 'ノベルティ';
      case 'goods':
        return 'グッズ';
      default:
        return '画像';
    }
  }

  /**
   * プレースホルダーを含むセクションを削除
   *
   * @param content コンテンツ
   * @param placeholder 検索するプレースホルダー
   * @param category カテゴリ名（ログ用）
   * @returns 削除結果
   */
  private removeSectionContaining(
    content: string,
    placeholder: string,
    category: string
  ): { content: string; removed: boolean } {
    // プレースホルダーが存在しない場合は何もしない
    if (!content.includes(placeholder)) {
      return { content, removed: false };
    }

    // セクション境界のパターン
    // h2 (##) から次の h2 まで、またはファイル終端まで
    const lines = content.split('\n');
    const placeholderIndex = lines.findIndex((line) => line.includes(placeholder));

    if (placeholderIndex === -1) {
      return { content, removed: false };
    }

    // プレースホルダーを含む行から上に遡ってh2を探す
    let sectionStart = -1;
    for (let i = placeholderIndex; i >= 0; i--) {
      if (lines[i].startsWith('## ')) {
        sectionStart = i;
        break;
      }
    }

    if (sectionStart === -1) {
      // h2が見つからない場合はプレースホルダーの行だけ削除
      lines.splice(placeholderIndex, 1);
      return { content: lines.join('\n'), removed: true };
    }

    // セクション終了位置を探す（次のh2または終端）
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        sectionEnd = i;
        break;
      }
    }

    // セクションを削除（前後の空行も調整）
    const beforeSection = lines.slice(0, sectionStart);
    const afterSection = lines.slice(sectionEnd);

    // 削除後に連続する空行を整理
    const newContent = [...beforeSection, ...afterSection].join('\n');
    const cleanedContent = newContent.replace(/\n{3,}/g, '\n\n');

    return { content: cleanedContent, removed: true };
  }
}

/**
 * シングルトンインスタンス
 */
let imagePlaceholderReplacerInstance: ImagePlaceholderReplacerService | null = null;

export function getImagePlaceholderReplacerService(): ImagePlaceholderReplacerService {
  if (!imagePlaceholderReplacerInstance) {
    imagePlaceholderReplacerInstance = new ImagePlaceholderReplacerService();
  }
  return imagePlaceholderReplacerInstance;
}

/**
 * シングルトンインスタンスをリセット（テスト用）
 */
export function resetImagePlaceholderReplacerService(): void {
  imagePlaceholderReplacerInstance = null;
}

export const imagePlaceholderReplacerService = {
  get instance() {
    return getImagePlaceholderReplacerService();
  },
};
