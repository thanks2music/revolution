/**
 * Vision API Interim Prompts
 *
 * @description
 * Templates YAML が完成するまでの暫定プロンプト。
 * E2E テストと本番実装で同じプロンプトを使用することを保証。
 *
 * @note
 * このファイルは Phase 0 (PoC) の暫定対応です。
 * Templates 側で vision-api.yaml が完成次第、削除されます。
 */

/**
 * Vision API 暫定プロンプト生成
 *
 * @param category - 抽出カテゴリ (menu / novelty / goods)
 * @returns 暫定プロンプト
 *
 * @example
 * ```typescript
 * const prompt = buildInterimVisionPrompt('menu');
 * const result = await visionApiService.extractMenuItems(imageUrls, prompt, 'menu');
 * ```
 */
export function buildInterimVisionPrompt(
  category: 'menu' | 'novelty' | 'goods'
): string {
  return `あなたはコラボカフェのメニュー情報を抽出する専門家です。
指定した画像内に書かれている日本語の文字列を抽出してください。

想定される日本語の情報:
- メニュー名
- 金額 (メニューの料金)
- キャラクター名 (メニュー名に含まれる場合は分離して抽出)
- その他の文字列情報 (出現頻度が高い例: ノベルティ情報)

# 抽出ルール

- メニュー名にキャラクター名が含まれる場合、characterName フィールドに分離する
  例: 「場地と千冬のマカロンパフェ」→ name: "マカロンパフェ", characterName: "場地と千冬"
- キャラクター名が不明な場合は、characterName を空文字列にする

# 出力形式

必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "menuItems": [
    {
      "name": "メニュー名（キャラクター名を含まない）",
      "price": 金額（数値のみ、例: 1200）,
      "characterName": "キャラクター名（例: 場地と千冬）または空文字列",
      "description": "メニューの説明（可能な限り）",
      "hasNovelty": true または false,
      "noveltyCondition": "ノベルティの配布条件（記載があれば）",
      "confidence": 0.0-1.0（抽出精度の自己評価）
    }
  ],
  "metadata": {
    "imageQuality": "high / medium / low",
    "hasComingSoonNotice": true または false,
    "extractionDifficulty": "easy / medium / hard"
  }
}

# 重要な注意事項

- 画像に「近日公開」「Coming Soon」と記載されている場合は、menuItems を空配列 [] で返してください
- 価格が記載されていない場合は null を設定してください
- キャラクター名が明確でない場合は空文字列 "" を設定してください
- confidence は抽出した情報の確実性を 0.0-1.0 で評価してください`;
}
