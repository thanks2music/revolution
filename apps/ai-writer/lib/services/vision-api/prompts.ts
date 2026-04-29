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
 * Vision API 暫定プロンプト生成（Phase 0: menu カテゴリのみ）
 *
 * @description
 * Phase 0 (PoC) では menu カテゴリのみ対応。goods/novelty は Templates v3 の
 * 1.5-vision-extraction.yaml が完全統合された時点で本ファイルごと削除予定。
 *
 * @param category - 抽出カテゴリ。Phase 0 では `'menu'` のみ受理
 * @returns 暫定プロンプト（menu 用）
 *
 * @example
 * ```typescript
 * const prompt = buildInterimVisionPrompt('menu');
 * const result = await visionApiService.extractFromImages({
 *   imageUrls,
 *   prompt,
 *   category: 'menu',
 * });
 * ```
 */
export function buildInterimVisionPrompt(
  category: 'menu'
): string {
  return `あなたはコラボカフェのメニュー情報を抽出する専門家です。
指定した画像内に書かれている日本語の文字列を抽出してください。

想定される日本語の情報:
- メニュー名
- 金額 (メニューの料金)
- キャラクター名 (メニュー名に含まれる場合は分離して抽出)
- その他の文字列情報 (出現頻度が高い例: ノベルティ情報)

# 抽出ルール

- メニュー名（name）は画像に記載されているままの文字列を抽出してください
- メニュー名にキャラクター名が含まれる場合、characterName フィールドに**配列形式**でキャラクター名を個別に抽出してください
- キャラクター名から装飾記号（★、♡、括弧など）や修飾語（ver、版など）は除去してください

  例1: 「場地と千冬のマカロンパフェ」
       → name: "場地と千冬のマカロンパフェ"
       → characterName: ["場地", "千冬"]

  例2: 「武道とマイキーのショートケーキ」
       → name: "武道とマイキーのショートケーキ"
       → characterName: ["武道", "マイキー"]

  例3: 「場地（制服ver）のドリンク」
       → name: "場地（制服ver）のドリンク"
       → characterName: ["場地"]  ※ 括弧と ver を除去

  例4: 「フライドポテト」（キャラクター名なし）
       → name: "フライドポテト"
       → characterName: []

- キャラクター名が含まれていない場合は、characterName を空配列 [] にしてください

# 出力形式

必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "menuItems": [
    {
      "name": "メニュー名（画像に記載されているまま）",
      "price": 金額（数値のみ、例: 1200）,
      "characterName": ["キャラクター1", "キャラクター2"] または [],
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
- characterName は必ず配列形式で返してください（文字列ではありません）
- キャラクター名が含まれていない場合は空配列 [] を設定してください
- confidence は抽出した情報の確実性を 0.0-1.0 で評価してください`;
}
