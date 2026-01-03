/**
 * TextPlaceholderReplacerService
 *
 * MDXコンテンツ内のテキストプレースホルダーを実データで置換するサービス
 *
 * @description
 * MDX記事生成パイプラインのStep 5.8で使用します。
 * - 単純変数: {{変数名}} → 値
 * - ネスト変数: {{オブジェクト.プロパティ}} → 値
 * - 配列アクセス: {{配列[i].プロパティ}} → 値
 * - 条件分岐: {{#if 条件}}...{{else}}...{{/if}}
 *
 * @see /notes/03-report/2025-12/2025-12-21-MDX本文改善-TextPlaceholderReplacerService実装方針.md
 */

/**
 * 開催期間の型定義
 */
export interface EventPeriod {
  開始: {
    年: string;
    日付: string;
  };
  終了: {
    年: string | null;
    日付: string | null;
    未定: boolean;
  };
}

/**
 * 作品情報の型定義
 */
export interface WorkInfo {
  title: string;
  is_primary: boolean;
}

/**
 * 店舗情報の型定義
 */
export interface StoreInfo {
  name: string;
  multiple_locations?: any;
}

/**
 * テキストプレースホルダー置換用のデータ
 * ExtractionResult から必要なフィールドを抽出
 */
export interface TextPlaceholderData {
  // 単純変数
  作品名: string;
  店舗名: string;
  メディアタイプ?: string;
  原作タイプ?: string;
  原作者有無?: boolean;
  原作者名?: string | null;
  略称?: string | null;
  開催回数?: string | null;
  公式サイトURL?: string | null;
  キャラクター名?: string[] | null;
  テーマ名?: string | null;
  ノベルティ名?: string | null;
  グッズ名?: string[] | null;

  // ネストオブジェクト
  開催期間: EventPeriod;

  // 配列
  works: WorkInfo[];

  // オブジェクト
  store: StoreInfo;

  // 派生変数（computeDerivedVariables で計算）
  primary_work?: WorkInfo;
  secondary_works?: WorkInfo[];
  is_multi_work?: boolean;
  コラボ作品名?: string;
}

/**
 * テキストプレースホルダー置換結果
 */
export interface TextPlaceholderReplacementResult {
  /** 置換後のコンテンツ */
  content: string;
  /** 置換されたプレースホルダー数 */
  replacedCount: number;
  /** 未置換のプレースホルダー（警告用） */
  unreplacedPlaceholders: string[];
  /** 置換詳細ログ（デバッグ用） */
  replacementLog: Array<{ placeholder: string; value: string }>;
}

/**
 * テキストプレースホルダー置換サービス
 */
export class TextPlaceholderReplacerService {
  /**
   * テキストプレースホルダーを実データで置換
   *
   * @param content MDXコンテンツ
   * @param data 置換用データ
   * @returns 置換結果
   */
  replaceAll(
    content: string,
    data: TextPlaceholderData
  ): TextPlaceholderReplacementResult {
    const replacementLog: Array<{ placeholder: string; value: string }> = [];
    let replacedCount = 0;

    // 派生変数を計算
    const enrichedData = this.computeDerivedVariables(data);

    let result = content;

    // 1. 条件分岐を処理（最初に処理）
    result = this.processConditionals(result, enrichedData, replacementLog);

    // 2. 配列アクセスを置換
    const arrayResult = this.replaceArrayAccessVariables(result, enrichedData);
    result = arrayResult.content;
    replacedCount += arrayResult.count;
    replacementLog.push(...arrayResult.log);

    // 3. ネスト変数を置換
    const nestedResult = this.replaceNestedVariables(result, enrichedData);
    result = nestedResult.content;
    replacedCount += nestedResult.count;
    replacementLog.push(...nestedResult.log);

    // 4. 単純変数を置換
    const simpleResult = this.replaceSimpleVariables(result, enrichedData);
    result = simpleResult.content;
    replacedCount += simpleResult.count;
    replacementLog.push(...simpleResult.log);

    // 未置換プレースホルダーを検出
    const unreplacedPlaceholders = this.detectUnreplacedPlaceholders(result);

    return {
      content: result,
      replacedCount,
      unreplacedPlaceholders,
      replacementLog,
    };
  }

  /**
   * 派生変数を計算（primary_work, is_multi_work など）
   */
  private computeDerivedVariables(data: TextPlaceholderData): TextPlaceholderData {
    const computed = { ...data };

    // works配列が存在する場合のみ派生変数を計算
    if (data.works && data.works.length > 0) {
      // primary_work: is_primary === true の作品
      computed.primary_work = data.works.find((w) => w.is_primary) || data.works[0];

      // secondary_works: is_primary === false の作品配列
      computed.secondary_works = data.works.filter((w) => !w.is_primary);

      // is_multi_work: 複数作品コラボかどうか
      computed.is_multi_work = data.works.length >= 2;

      // コラボ作品名: テーブル表示用
      computed.コラボ作品名 =
        data.works.length === 1
          ? data.works[0].title
          : data.works.map((w) => w.title).join(' × ');
    } else {
      // works配列がない場合のフォールバック
      computed.primary_work = { title: data.作品名, is_primary: true };
      computed.secondary_works = [];
      computed.is_multi_work = false;
      computed.コラボ作品名 = data.作品名;
    }

    return computed;
  }

  /**
   * 単純変数を置換: {{変数名}} → 値
   */
  private replaceSimpleVariables(
    content: string,
    data: TextPlaceholderData
  ): { content: string; count: number; log: Array<{ placeholder: string; value: string }> } {
    const log: Array<{ placeholder: string; value: string }> = [];
    let count = 0;
    let result = content;

    // 単純変数のマッピング
    const simpleVariables: Record<string, string | undefined> = {
      作品名: data.作品名,
      店舗名: data.店舗名,
      メディアタイプ: data.メディアタイプ,
      原作タイプ: data.原作タイプ,
      原作者名: data.原作者名 ?? undefined,
      略称: data.略称 ?? undefined,
      開催回数: data.開催回数 ?? undefined,
      公式サイトURL: data.公式サイトURL ?? undefined,
      テーマ名: data.テーマ名 ?? undefined,
      ノベルティ名: data.ノベルティ名 ?? undefined,
      コラボ作品名: data.コラボ作品名,
    };

    for (const [varName, value] of Object.entries(simpleVariables)) {
      if (value === undefined || value === null) continue;

      const placeholder = `{{${varName}}}`;
      if (result.includes(placeholder)) {
        result = result.split(placeholder).join(value);
        count++;
        log.push({ placeholder, value });
      }
    }

    // Boolean値の処理
    if (data.原作者有無 !== undefined) {
      const placeholder = '{{原作者有無}}';
      if (result.includes(placeholder)) {
        const value = String(data.原作者有無);
        result = result.split(placeholder).join(value);
        count++;
        log.push({ placeholder, value });
      }
    }

    // 配列のjoin処理: {{キャラクター名|join:'・'}}
    if (data.キャラクター名 && data.キャラクター名.length > 0) {
      const joinPattern = /\{\{キャラクター名\|join:'([^']+)'\}\}/g;
      result = result.replace(joinPattern, (match, separator) => {
        const value = data.キャラクター名!.join(separator);
        count++;
        log.push({ placeholder: match, value });
        return value;
      });
    }

    if (data.グッズ名 && data.グッズ名.length > 0) {
      const joinPattern = /\{\{グッズ名\|join:'([^']+)'\}\}/g;
      result = result.replace(joinPattern, (match, separator) => {
        const value = data.グッズ名!.join(separator);
        count++;
        log.push({ placeholder: match, value });
        return value;
      });
    }

    return { content: result, count, log };
  }

  /**
   * ネスト変数を置換: {{オブジェクト.プロパティ}} → 値
   */
  private replaceNestedVariables(
    content: string,
    data: TextPlaceholderData
  ): { content: string; count: number; log: Array<{ placeholder: string; value: string }> } {
    const log: Array<{ placeholder: string; value: string }> = [];
    let count = 0;
    let result = content;

    // ネスト変数のパターン: {{path.to.value}}
    // 配列アクセスは除外（別メソッドで処理）
    const nestedPattern = /\{\{([a-zA-Z_\u3040-\u9FFF]+(?:\.[a-zA-Z_\u3040-\u9FFF]+)+)\}\}/g;

    result = result.replace(nestedPattern, (match, path) => {
      const value = this.getNestedValue(data, path);
      if (value !== undefined && value !== null) {
        count++;
        const strValue = String(value);
        log.push({ placeholder: match, value: strValue });
        return strValue;
      }
      // 値がない場合はそのまま残す
      return match;
    });

    return { content: result, count, log };
  }

  /**
   * 配列アクセスを置換: {{配列[i].プロパティ}} → 値
   */
  private replaceArrayAccessVariables(
    content: string,
    data: TextPlaceholderData
  ): { content: string; count: number; log: Array<{ placeholder: string; value: string }> } {
    const log: Array<{ placeholder: string; value: string }> = [];
    let count = 0;
    let result = content;

    // 配列アクセスのパターン: {{arrayName[index].property}} または {{arrayName[index]}}
    const arrayAccessPattern =
      /\{\{([a-zA-Z_\u3040-\u9FFF]+)\[(\d+)\](?:\.([a-zA-Z_\u3040-\u9FFF]+))?\}\}/g;

    result = result.replace(arrayAccessPattern, (match, arrayName, indexStr, property) => {
      const index = parseInt(indexStr, 10);
      const array = this.getNestedValue(data, arrayName) as any[];

      if (Array.isArray(array) && index < array.length) {
        const item = array[index];
        let value: any;

        if (property) {
          value = item?.[property];
        } else {
          value = item;
        }

        if (value !== undefined && value !== null) {
          count++;
          const strValue = String(value);
          log.push({ placeholder: match, value: strValue });
          return strValue;
        }
      }

      // 値がない場合はそのまま残す
      return match;
    });

    return { content: result, count, log };
  }

  /**
   * 条件分岐を処理: {{#if ...}}...{{else}}...{{/if}}
   */
  private processConditionals(
    content: string,
    data: TextPlaceholderData,
    log: Array<{ placeholder: string; value: string }>
  ): string {
    let result = content;

    // {{#if condition}}...{{else}}...{{/if}} パターン
    const ifElsePattern =
      /\{\{#if\s+([^\}]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;

    result = result.replace(ifElsePattern, (match, condition, ifBlock, elseBlock) => {
      const conditionResult = this.evaluateCondition(condition.trim(), data);
      const value = conditionResult ? ifBlock : elseBlock;
      log.push({ placeholder: `{{#if ${condition}}}`, value: `→ ${conditionResult}` });
      return value;
    });

    // {{#if condition}}...{{/if}} パターン（elseなし）
    const ifOnlyPattern = /\{\{#if\s+([^\}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

    result = result.replace(ifOnlyPattern, (match, condition, ifBlock) => {
      const conditionResult = this.evaluateCondition(condition.trim(), data);
      const value = conditionResult ? ifBlock : '';
      log.push({ placeholder: `{{#if ${condition}}}`, value: `→ ${conditionResult}` });
      return value;
    });

    // {{#unless condition}}...{{/unless}} パターン
    const unlessPattern = /\{\{#unless\s+([^\}]+)\}\}([\s\S]*?)\{\{\/unless\}\}/g;

    result = result.replace(unlessPattern, (match, condition, unlessBlock) => {
      const conditionResult = this.evaluateCondition(condition.trim(), data);
      const value = conditionResult ? '' : unlessBlock;
      log.push({ placeholder: `{{#unless ${condition}}}`, value: `→ ${!conditionResult}` });
      return value;
    });

    return result;
  }

  /**
   * 条件式を評価
   *
   * サポートする条件:
   * - 単純な存在チェック: "開催期間.終了.未定" → truthy/falsy
   * - 等価比較: "開催期間.開始.年 === 開催期間.終了.年"
   * - 不等価比較: "開催期間.開始.年 !== 開催期間.終了.年"
   */
  private evaluateCondition(condition: string, data: TextPlaceholderData): boolean {
    // 等価比較: path1 === path2
    const equalMatch = condition.match(/^(.+?)\s*===\s*(.+)$/);
    if (equalMatch) {
      const left = this.getNestedValue(data, equalMatch[1].trim());
      const right = this.getNestedValue(data, equalMatch[2].trim());
      return left === right;
    }

    // 不等価比較: path1 !== path2
    const notEqualMatch = condition.match(/^(.+?)\s*!==\s*(.+)$/);
    if (notEqualMatch) {
      const left = this.getNestedValue(data, notEqualMatch[1].trim());
      const right = this.getNestedValue(data, notEqualMatch[2].trim());
      return left !== right;
    }

    // 単純な存在/truthy チェック
    const value = this.getNestedValue(data, condition);
    return Boolean(value);
  }

  /**
   * オブジェクトからネストされた値を取得
   * @example getNestedValue(data, "開催期間.開始.日付") → "12月18日"
   */
  private getNestedValue(obj: any, path: string): any {
    if (!path) return undefined;

    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[key];
    }

    return value;
  }

  /**
   * 未置換のプレースホルダーを検出
   */
  private detectUnreplacedPlaceholders(content: string): string[] {
    const unreplaced: string[] = [];

    // {{...}} 形式のプレースホルダーを検出
    // 条件分岐（{{#if}}, {{#unless}}, {{else}}, {{/if}}, {{/unless}}）は除外
    const placeholderPattern = /\{\{(?!#if|#unless|else|\/if|\/unless)[^{}]+\}\}/g;
    const matches = content.match(placeholderPattern);

    if (matches) {
      unreplaced.push(...matches);
    }

    return unreplaced;
  }
}

/**
 * シングルトンインスタンス
 */
let textPlaceholderReplacerInstance: TextPlaceholderReplacerService | null = null;

export function getTextPlaceholderReplacerService(): TextPlaceholderReplacerService {
  if (!textPlaceholderReplacerInstance) {
    textPlaceholderReplacerInstance = new TextPlaceholderReplacerService();
  }
  return textPlaceholderReplacerInstance;
}

/**
 * シングルトンインスタンスをリセット（テスト用）
 */
export function resetTextPlaceholderReplacerService(): void {
  textPlaceholderReplacerInstance = null;
}

export const textPlaceholderReplacerService = {
  get instance() {
    return getTextPlaceholderReplacerService();
  },
};
