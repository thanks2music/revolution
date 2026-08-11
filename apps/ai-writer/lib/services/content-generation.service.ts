/**
 * Content Generation Service
 * 抽出済み情報から記事本文（MDX）を生成するサービス
 *
 * @description
 * モジュール化テンプレート（4-content.yaml + sections/*.yaml）を使用して、
 * AIに記事本文を生成させます。
 *
 * 方針A（AI-based）を採用:
 * - YAMLテンプレートのルール定義をAIプロンプトに含める
 * - セクションスキップの判断はAIに委ねる
 * - 作品タイプに応じた柔軟な文章生成が可能
 */

import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import type { MergedModularTemplate, SectionTemplate } from '@/lib/types/modular-template';
import type { ExtractionResult } from './extraction.service';
// Sprint C-β P11 (2026-07-19): §6.2 メディア形態表記マップの解決 + 日本語対訳注入
import { getMediaFormResolverService } from './media-form-resolver.service';
import { getMediaTypeMapperService } from './media-type-mapper.service';
import { formatAuthorName } from '@/lib/utils/author-formatter';
import { shouldSuppressInlinePromptDump } from '@/lib/ai/observability/ai-call-recorder';

/**
 * Token usage statistics for cost tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * カテゴリ別画像情報
 */
export interface CategoryImages {
  /** メニュー画像のURL配列 */
  menu: string[];
  /** ノベルティ画像のURL配列 */
  novelty: string[];
  /** グッズ画像のURL配列 */
  goods: string[];
}

/**
 * コンテンツ生成リクエスト
 */
export interface ContentGenerationRequest {
  /** 2-extraction の出力 */
  extractedData: ExtractionResult;
  /** 3-title の出力 */
  generatedTitle: string;
  /** 公式サイトのHTMLコンテンツ（参考情報） */
  officialHtml?: string;
  /** カテゴリ別画像情報（category-image-extraction step で抽出） */
  categoryImages?: CategoryImages;
}

/**
 * コンテンツ生成結果
 */
export interface ContentGenerationResult {
  /** 生成されたMDX本文 */
  content: string;
  /** 生成されたセクション一覧 */
  generatedSections: string[];
  /** スキップされたセクション一覧 */
  skippedSections: string[];
  /** Model used for generation */
  model?: string;
  /** Token usage statistics for cost tracking */
  usage?: TokenUsage;
}

/**
 * コンテンツ生成サービス
 */
export class ContentGenerationService {
  private templateLoader: YamlTemplateLoaderService;
  private aiProvider: AiProvider;
  /** モジュール化テンプレートID */
  private readonly templateId = 'collabo-cafe';
  /** パイプラインID */
  private readonly pipelineId = '4-content';

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader || new YamlTemplateLoaderService();
    this.aiProvider = aiProvider || createAiProvider();
  }

  /**
   * 記事本文（MDX）を生成
   * @param request コンテンツ生成リクエスト
   * @returns 生成されたMDX本文
   */
  async generateContent(request: ContentGenerationRequest): Promise<ContentGenerationResult> {
    try {
      console.log('[ContentGeneration] 本文生成開始');

      // モジュール化YAMLテンプレートを読み込み（セクション含む）
      const template = await this.templateLoader.loadModularTemplate(
        this.templateId,
        this.pipelineId,
        { includeSections: true }
      );

      // デバッグ: 読み込んだテンプレート情報を出力
      if (process.env.DEBUG_TEMPLATE_LOADING === 'true') {
        console.log('\n[ContentGeneration] === 読み込んだテンプレート情報 ===');
        console.log('Template ID:', this.templateId);
        console.log('Pipeline ID:', this.pipelineId);

        if (template._sections?.templates) {
          console.log('利用可能なセクション:');
          for (const [sectionId, sectionTemplate] of Object.entries(template._sections.templates)) {
            const section = sectionTemplate as any;
            console.log(`  - ${sectionId}: ${section.section?.name || 'unnamed'}`);

            // 各セクションの利用可能なテンプレート一覧
            if (section.templates) {
              const templateIds = Object.keys(section.templates);
              console.log(`    テンプレート: ${templateIds.join(', ')}`);
            }
          }
        }
        console.log('[ContentGeneration] === テンプレート情報終了 ===\n');
      }

      // プロンプトを構築（YAMLテンプレート全体を含む）
      const prompt = this.buildPrompt(template, request);

      // デバッグ: 送信プロンプトをログ出力
      if (process.env.DEBUG_CONTENT_PROMPT === 'true' && !shouldSuppressInlinePromptDump('content-generation')) {
        console.log('\n[ContentGeneration] ========== 送信プロンプト全文 ==========');
        console.log(prompt);
        console.log('[ContentGeneration] ========== プロンプト終了 ==========\n');
      }

      // AI Provider経由でAPI呼び出し
      const response = await this.aiProvider.sendMessage(prompt, {
        stepId: 'content-generation',
        maxTokens: 8000, // MDX本文生成のため大きめに
        temperature: 0.7, // 創造性を許容
        responseFormat: 'json',
      });

      // AI APIのレスポンスをログ出力
      console.log('\n[ContentGeneration] === AI APIレスポンス ===');
      console.log(`[ContentGeneration] model: ${response.model}`);
      console.log('[ContentGeneration] === レスポンス終了 ===\n');

      // レスポンスをパース
      const result = this.parseResponse(response.content, template);

      console.log('[ContentGeneration] 本文生成完了:', {
        contentLength: result.content.length,
        generatedSections: result.generatedSections,
        skippedSections: result.skippedSections,
      });

      // model/usage をコスト追跡用に追加
      return {
        ...result,
        model: response.model,
        usage: response.usage,
      };
    } catch (error) {
      console.error('[ContentGeneration] 本文生成エラー:', error);
      throw new Error(
        `本文生成失敗: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * プロンプトを構築 (Sprint C-β P11 Phase 2e/3、案 D 統合修正)
   *
   * Phase 2e で LeadGenerator が lead を rule-driven で生成するように pipeline を
   * 変更したため、本 buildPrompt では **lead セクションを完全に scope 外**にする。
   * また、`extractedData` の英語 slug (`メディアタイプ = manga` 等) を LLM が
   * literal 参照して自然文に流出する Route 2 バグを防ぐため、日本語対訳の派生
   * 変数を JSON に注入する。
   *
   * @param template モジュール化YAMLテンプレート
   * @param request リクエストデータ
   * @returns 完成したプロンプト
   */
  private buildPrompt(
    template: MergedModularTemplate,
    request: ContentGenerationRequest
  ): string {
    // YAMLテンプレートのルール定義をプロンプトに含める
    const rulesSection = this.buildRulesSection(template);
    // Sprint C-β P11: lead セクションを除外して sections プロンプトを組み立てる
    const sectionsSection = this.buildSectionsSection(template);
    // Sprint C-β P11: extractedData に日本語対訳の派生変数を注入 (Bug 1 対策)
    const enrichedExtractedData = this.enrichExtractedDataForPrompt(request.extractedData);

    // 最終プロンプトを構築
    return `${template.prompts.generate_content}

${rulesSection}

${sectionsSection}

---

## 入力データ

### extracted_data (2-extraction の出力 + Sprint C-β P11 日本語対訳の派生変数)
\`\`\`json
${JSON.stringify(enrichedExtractedData, null, 2)}
\`\`\`

### generated_title (3-title の出力)
${request.generatedTitle}

${request.officialHtml ? `### 参考: 公式サイトの内容（一部）
${request.officialHtml.substring(0, 5000)}${request.officialHtml.length > 5000 ? '\n...(truncated)' : ''}` : ''}

${this.buildCategoryImagesSection(template, request.categoryImages)}

---

上記の入力データとルールに従い、JSON形式でのみ出力してください。

出力形式 (Sprint C-β P11 で lead を除外、menu/novelty/goods/summary のみ):
\`\`\`json
{
  "content": "生成されたMDX本文 (menu/novelty/goods/summary の 4 セクションを結合、lead は含めない)",
  "generatedSections": ["menu", "novelty", "goods", "summary"],
  "skippedSections": ["スキップしたセクションID"]
}
\`\`\`

【Sprint C-β P11 重要】リード文 (lead) は絶対に生成しない
- lead セクションは Revolution 側 LeadGeneratorService が **rule-driven** で既に生成済み
- 本 step の \`content\` フィールドには **menu / novelty / goods / summary の 4 セクションのみ** を含める
- 「〜のテーマカフェが〜にて開催される」等のリード文相当の文を \`content\` 冒頭に生成することは禁止
- MDX 本文は menu セクションの H2 見出し (\`## {{見出し主語}}のメニュー\`) から開始する
- 出力後、呼び出し側で LeadGenerator 生成の leadMdx が \`content\` の先頭に concat される

【S1-d Phase 3 重要】H2 見出しの会場表記は自分で組み立てない
- H2 の主語は \`{{見出し主語}}\` プレースホルダーを**そのまま**残すこと。置換は呼び出し側が行う
- \`{{見出し主語}}\` を実際の作品名や店舗名に展開して書き下すことは禁止
- **複数の会場名を「、」で連結して見出しに入れることは絶対禁止**
  - 例 (誤): \`## トイ・ストーリー5 × OH MY CAFE 表参道ヒルズ、BOX cafe&space ルミネエスト新宿2号店のメニュー\`
  - 例 (正): \`## {{見出し主語}}のメニュー\`
- 理由: 代表として出す会場は Revolution 側が occurrences[] と公式サイトのドメインから
  決定的に選んでいる。ここで書き下すとその判断が上書きされ、連結が再発する

【Sprint C-β P11 重要】メディアタイプ・原作タイプの表記
- 本文中で「メディアタイプ」を語る際は、日本語対訳 (メディアタイプ_label / メディア形態表記) のみを使用
- **英語 slug (\`manga\` / \`character\` / \`anime_movie\` 等) を本文中に literal で出力することは絶対禁止**
- 例 (誤): 「開催されるmanga「作品名」」
- 例 (正): 「開催される漫画「作品名」」または「開催されるキャラクター「作品名」」
- extracted_data 内の \`メディアタイプ_label\` / \`メディア形態表記\` / \`原作者名_formatted\` を優先参照

【共通ルール】
- JSON以外のテキストは一切出力しないこと
- 各セクション間は空行で区切る
- h1 は使用しない（タイトルで使用されるため）
- セクションのスキップ判断は skip_if 条件に従う
- 原作者有無 === true の場合のみ「○○先生」または「○○さん」形式で原作者名を使用
- 開催期間は { 開始: { 年, 日付 }, 終了: { 年, 日付, 未定 } } 構造で渡される（年またぎ対応）`;
  }

  /**
   * `extractedData` に §6.2 メディア形態表記 + §6.1 派生変数を注入して LLM に渡す (Bug 1 対策)。
   *
   * ## 課題 (Sprint C-α までの挙動)
   *
   * LLM は input JSON を literal 参照して自然文に埋め込む挙動があるため、英語 slug
   * (`メディアタイプ = 'manga'`) だけを提示すると本文に "manga" が literal 挿入される
   * (Bug 1、Route 2)。
   *
   * ## 対策 (Sprint C-β P11 Phase 3 案 D+)
   *
   * **`メディアタイプ` field 自体を日本語 label で上書き**し、英語 slug は
   * `メディアタイプ_slug` (別名) に隔離する。上書き値は §6.2 対訳マップの
   * **メディア形態表記 (Sprint D Phase 2-a 反転仕様 = メディアタイプ 14 種優先 → 原作タイプ
   * 16 種 fallback、refined reversal)** を採用することで、N2 (英語 slug 漏れ) を解消する。
   * 呪術廻戦カフェ (manga_based + anime) 等は反転後「アニメ」を返し、
   * illustrator_based + other 等は refined fallback で「イラスト」等の precision を維持する。
   *
   * 英語 slug (`メディアタイプ_slug`) は分岐判定用として提示するが、literal 使用は
   * prompt instruction で明示的に禁止する。
   */
  private enrichExtractedDataForPrompt(
    extractedData: ExtractionResult
  ):
    | (Omit<ExtractionResult, 'メディアタイプ'> & {
        // R2 対応: `メディアタイプ` field を string (日本語 label) として明示的に redefine。
        // 過去は `as unknown as ExtractionResult['メディアタイプ']` の型キャストで enum 型を
        // 誤って主張していたが、Omit + 再宣言で「LLM prompt に渡す enriched view では
        // 日本語 label が入る」ことを型レベルで正しく表現する。英語 slug は `メディアタイプ_slug`
        // に隔離して MediaType enum 型のまま保持する。
        メディアタイプ: string;
        メディアタイプ_slug: ExtractionResult['メディアタイプ'];
        メディアタイプ_label: string;
        メディア形態表記: string;
        原作者名_formatted: string;
      })
    | ExtractionResult {
    try {
      const mediaTypeMapper = getMediaTypeMapperService();
      const mediaFormResolver = getMediaFormResolverService();

      const mediaFormLabel = mediaFormResolver.resolve(
        extractedData.原作タイプ,
        extractedData.メディアタイプ
      );

      return {
        ...extractedData,
        // Sprint C-β P11 Phase 3 対策 (Sprint D Phase 2-a で resolver 反転仕様に更新):
        // `メディアタイプ` 自体を日本語 label で上書き (LLM の literal 誤挿入 = N2 を根本防止)。
        // 反転後は mediaFormResolver が Step 1 でメディアタイプ label を優先するため、
        // 例えば novel_based + anime は「アニメ」となり、旧 P5 期待 (「ライトノベル」) は
        // メディアタイプ未指定/generic/unknown 時 (Step 2 fallback) のみ復活する。
        // 返却型で `メディアタイプ: string` に redefine 済のため `as unknown as` 不要。
        メディアタイプ: mediaFormLabel,
        // 英語 slug は _slug suffix で分岐用に隔離 (literal 使用は prompt 内で禁止 instruction)
        メディアタイプ_slug: extractedData.メディアタイプ,
        // §6.2 メディアタイプ 14 種 fallback の日本語対訳 (例: 'manga' → '漫画')
        メディアタイプ_label: mediaTypeMapper.getLabel(extractedData.メディアタイプ),
        // §6.2 メディア形態表記 (Sprint D Phase 2-a 反転: メディアタイプ 14 種優先 → 原作タイプ 16 種 fallback)
        メディア形態表記: mediaFormLabel,
        // 原作者名の統一フォーマット (string | string[] | null → string)
        原作者名_formatted: formatAuthorName(extractedData.原作者名),
      };
    } catch (error) {
      // config load 失敗時等の safe fallback: extractedData をそのまま返す。
      // R2 Minor #2: この silent fallback は Bug 1 (英語 slug 漏れ) の silent regression risk
      // となるため、Sprint C-β P10 (observability) で Sentry / structured log に promote 予定。
      console.warn(
        `[ContentGeneration] enrichExtractedDataForPrompt failed, falling back to raw extractedData:`,
        error instanceof Error ? error.message : error
      );
      return extractedData;
    }
  }

  /**
   * ルールセクションを構築
   */
  private buildRulesSection(template: MergedModularTemplate): string {
    const sections: string[] = [];

    // パイプラインのlogicセクション
    if (template.logic) {
      sections.push('## コンテンツ生成ロジック');

      if (template.logic.work_type_template_selection) {
        sections.push(`### 作品タイプ別テンプレート選択\n\n${template.logic.work_type_template_selection}`);
      }

      if (template.logic.section_skip_conditions) {
        sections.push(`### セクションスキップ条件\n\n${template.logic.section_skip_conditions}`);
      }

      if (template.logic.date_format_handling) {
        sections.push(`### 日付フォーマット\n\n${template.logic.date_format_handling}`);
      }
    }

    // 出力構造
    if (template.output?.structure) {
      sections.push(`## 出力セクション構造\n\n${template.output.structure.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    }

    return sections.join('\n\n');
  }

  /**
   * セクション定義をプロンプト用に構築 (Sprint C-β P11 Phase 2e/3、案 D 統合修正)
   *
   * Phase 2e で LeadGenerator が lead を rule-driven で生成するようになったため、
   * 本 method は **lead セクションを除外**して menu/novelty/goods/summary のみを
   * LLM prompt に露出する。lead の template preview が prompt に含まれると LLM が
   * 独自に lead を生成する Bug 2 (Pochacco 症状) が発生するため、除外は必須。
   */
  private buildSectionsSection(template: MergedModularTemplate): string {
    if (!template._sections?.templates) {
      return '';
    }

    const sections: string[] = [
      '## セクション定義 (Sprint C-β P11: lead は LeadGeneratorService の責務、本 step の対象外)',
      '',
      '【重要：セクションIDと見出しの扱い】',
      '- 以下のセクションID（02-menu, 03-novelty 等）は**内部識別子**です',
      '- **本文にセクションIDを見出しとして出力しないでください**',
      '- 各セクションの「テンプレート例」に定義されている見出し形式を使用してください',
      '- lead セクションは本 step の scope 外 (Revolution 側 LeadGeneratorService で rule-driven 生成済み)',
      '- メニュー/ノベルティ/グッズ/まとめセクションはテンプレート内の `## ○○` 形式の見出しを使用してください',
      '',
    ];

    // Sprint C-β P11: lead セクションを除外 (Phase 2e で LeadGeneratorService が担当)
    // NOTE: _meta.yaml の sections.order は "01-lead" (数字プレフィックス付き) で
    // 定義されているため、id.includes('lead') で robust に除外する
    // (Bug 1/2 案 D 修正時の key mismatch fix)
    // R2 対応: substring match (`includes('lead')`) は将来 "lead" を含む別 section id
    // (例: "lead_out_notice") に false positive で silent 除外するリスクあり。numeric prefix
    // (`01-lead` / `10-lead` 等) を stripped した上での **完全一致** に改める。
    const nonLeadEntries = Object.entries(template._sections.templates).filter(
      ([sectionId]) => sectionId.replace(/^\d+-/, '').toLowerCase() !== 'lead'
    );

    for (const [sectionId, sectionTemplate] of nonLeadEntries) {
      const section = sectionTemplate as SectionTemplate;
      const sectionInfo: string[] = [];

      // セクションIDは識別子として表示（本文には使用しない旨を明記）
      sectionInfo.push(`### セクション「${section.section?.name || sectionId}」（識別子: ${sectionId}）`);

      // スキップ条件
      if (section.skip_if) {
        sectionInfo.push(`**スキップ条件**: \`${section.skip_if}\``);
      }

      // 必須プレースホルダー
      if (section.required_placeholders) {
        sectionInfo.push(`**必須項目**: ${section.required_placeholders.join(', ')}`);
      }

      // オプションプレースホルダー
      if (section.optional_placeholders) {
        sectionInfo.push(`**オプション項目**: ${section.optional_placeholders.join(', ')}`);
      }

      // 条件分岐
      if (section.conditions) {
        sectionInfo.push('\n**条件分岐**:');
        for (const cond of section.conditions) {
          sectionInfo.push(`- \`${cond.id}\`: ${cond.condition} → テンプレート \`${cond.template}\``);
        }
      }

      // テンプレート例
      if (section.templates) {
        sectionInfo.push('\n**テンプレート例**:');
        for (const [tmplId, tmplContent] of Object.entries(section.templates)) {
          // 最初の200文字だけ表示（プロンプトが長くなりすぎないように）
          const preview = String(tmplContent).substring(0, 300);
          sectionInfo.push(`\n\`${tmplId}\`:\n\`\`\`\n${preview}${String(tmplContent).length > 300 ? '\n...(truncated)' : ''}\n\`\`\``);
        }
      }

      sections.push(sectionInfo.join('\n'));
    }

    return sections.join('\n\n');
  }

  /**
   * カテゴリ別画像情報セクションを構築
   * セクションスキップの判断に画像有無を使用するための情報を提供
   *
   * @description
   * v2.3.0 以降: YAMLテンプレート(4-content.yaml)の logic.category_images_instruction から
   * 指示文を読み込み、{{category_images_table}} プレースホルダーを動的テーブルに置換する。
   * YAML に該当フィールドがない場合はフォールバックとして空文字列を返す。
   *
   * @param template モジュール化YAMLテンプレート
   * @param categoryImages カテゴリ別画像情報
   * @returns カテゴリ別画像情報セクション文字列
   */
  private buildCategoryImagesSection(
    template: MergedModularTemplate,
    categoryImages?: CategoryImages
  ): string {
    if (!categoryImages) {
      return '';
    }

    // YAML から category_images_instruction を取得
    const instructionTemplate = template.logic?.category_images_instruction;

    if (!instructionTemplate) {
      // フォールバック: YAML に定義がない場合は空文字列を返す
      console.warn(
        '[ContentGeneration] ⚠️ logic.category_images_instruction が YAML に定義されていません'
      );
      return '';
    }

    // 動的テーブルを構築
    const categoryImagesTable = this.buildCategoryImagesTable(categoryImages);

    // {{category_images_table}} プレースホルダーを動的テーブルに置換
    const result = instructionTemplate.replace(
      '{{category_images_table}}',
      categoryImagesTable
    );

    return result;
  }

  /**
   * カテゴリ別画像情報のMarkdownテーブルを構築
   *
   * @param categoryImages カテゴリ別画像情報
   * @returns Markdownテーブル形式の文字列
   */
  private buildCategoryImagesTable(categoryImages: CategoryImages): string {
    const { menu, novelty, goods } = categoryImages;

    const tableRows = [
      '| カテゴリ | 画像数 | アクション |',
      '|----------|--------|------------|',
      `| メニュー | ${menu.length}件 | ${menu.length > 0 ? 'セクション生成' : 'スキップ'} |`,
      `| ノベルティ | ${novelty.length}件 | ${novelty.length > 0 ? 'セクション生成' : 'スキップ'} |`,
      `| グッズ | ${goods.length}件 | ${goods.length > 0 ? 'セクション生成' : 'スキップ'} |`,
    ];

    return tableRows.join('\n');
  }

  /**
   * 不正なJSONを修正する
   * AIが生成するJSONには不正なエスケープ文字が含まれることがある
   */
  private fixMalformedJson(jsonStr: string): string {
    // 文字列を行ごとに処理
    const lines = jsonStr.split('\n');
    const result: string[] = [];
    let inContentField = false;
    let contentBuffer: string[] = [];

    for (const line of lines) {
      // "content": " で始まる行を検出
      if (line.match(/^\s*"content"\s*:\s*"/)) {
        inContentField = true;
        contentBuffer = [line];
        // この行で完結している場合（"content": "..." で終わる）
        if (line.match(/"\s*,?\s*$/)) {
          result.push(line);
          inContentField = false;
          contentBuffer = [];
        }
        continue;
      }

      if (inContentField) {
        contentBuffer.push(line);
        // "generatedSections" または "skippedSections" または } で終わる行を検出
        if (line.match(/"\s*,?\s*"(?:generatedSections|skippedSections)"/) || line.match(/"\s*\}\s*$/)) {
          // contentフィールドの内容を結合してエスケープ処理
          const contentStr = contentBuffer.join('\n');
          const escapedContent = this.escapeContentField(contentStr);
          result.push(escapedContent);
          inContentField = false;
          contentBuffer = [];
        }
      } else {
        result.push(line);
      }
    }

    // バッファに残っている場合
    if (contentBuffer.length > 0) {
      const contentStr = contentBuffer.join('\n');
      const escapedContent = this.escapeContentField(contentStr);
      result.push(escapedContent);
    }

    return result.join('\n');
  }

  /**
   * contentフィールドの値をエスケープ
   */
  private escapeContentField(contentStr: string): string {
    // "content": "..." の形式を抽出
    const match = contentStr.match(/^(\s*"content"\s*:\s*")([\s\S]*?)("(?:\s*,\s*"(?:generatedSections|skippedSections)"|\s*\})?[\s\S]*)$/);

    if (!match) {
      return contentStr;
    }

    const [, prefix, value, suffix] = match;

    // 値部分の不正な文字をエスケープ
    const escapedValue = value
      // 既にエスケープされている \n, \t, \" は一時的に置換
      .replace(/\\n/g, '\u0000NEWLINE\u0000')
      .replace(/\\t/g, '\u0000TAB\u0000')
      .replace(/\\"/g, '\u0000QUOTE\u0000')
      .replace(/\\\\/g, '\u0000BACKSLASH\u0000')
      // 未エスケープの特殊文字をエスケープ
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      // 文字列内の未エスケープのダブルクォートをエスケープ
      // （ただし最後の " は除く）
      .replace(/(?<!\\)"/g, '\\"')
      // 一時置換を復元
      .replace(/\u0000NEWLINE\u0000/g, '\\n')
      .replace(/\u0000TAB\u0000/g, '\\t')
      .replace(/\u0000QUOTE\u0000/g, '\\"')
      .replace(/\u0000BACKSLASH\u0000/g, '\\\\');

    return prefix + escapedValue + suffix;
  }

  /**
   * JSONレスポンスをサニタイズ（不正なエスケープ文字を修正）
   * @deprecated Use fixMalformedJson instead
   */
  private sanitizeJsonResponse(response: string): string {
    // 1. コードブロックから抽出
    let jsonStr = response.trim();
    const jsonMatch =
      jsonStr.match(/```json\n([\s\S]*?)\n```/) ||
      jsonStr.match(/```\n([\s\S]*?)\n```/);

    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // 2. JSON文字列内の不正なエスケープを修正
    // content フィールド内の改行を \n にエスケープ
    try {
      // まず "content": "..." の部分を見つけて、その中の改行を処理
      jsonStr = jsonStr.replace(
        /"content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"generatedSections|"\s*,\s*"skippedSections|"\s*\})/,
        (match, content) => {
          // content内の実際の改行を \n にエスケープ
          const escapedContent = content
            .replace(/\\/g, '\\\\') // バックスラッシュをエスケープ
            .replace(/\n/g, '\\n')   // 改行をエスケープ
            .replace(/\r/g, '\\r')   // キャリッジリターンをエスケープ
            .replace(/\t/g, '\\t')   // タブをエスケープ
            .replace(/"/g, '\\"');   // ダブルクォートをエスケープ（既にエスケープされているものを除く）

          // マッチした終端部分を復元
          const endPart = match.substring(match.lastIndexOf('"'));
          return `"content": "${escapedContent}${endPart}`;
        }
      );
    } catch {
      // サニタイズに失敗した場合は元の文字列を返す
      console.warn('[ContentGeneration] JSON sanitization failed, using original');
    }

    return jsonStr;
  }

  /**
   * AI APIからのレスポンスをパース
   */
  private parseResponse(
    response: string,
    template: MergedModularTemplate
  ): ContentGenerationResult {
    try {
      let jsonData: {
        content: string;
        generatedSections?: string[];
        skippedSections?: string[];
      };

      // デバッグ: 生のレスポンスを出力
      if (process.env.DEBUG_CONTENT_RESPONSE === 'true') {
        console.log('\n[ContentGeneration] === 生のAIレスポンス ===');
        console.log(response);
        console.log('[ContentGeneration] === 生レスポンス終了 ===\n');
      }

      // JSONを抽出してパース
      try {
        jsonData = JSON.parse(response.trim());
      } catch (directParseError) {
        console.log('[ContentGeneration] Direct parse failed, trying extraction...');

        // マークダウンコードブロックから抽出を試みる
        const jsonMatch =
          response.match(/```json\n([\s\S]*?)\n```/) ||
          response.match(/```\n([\s\S]*?)\n```/) ||
          response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error('[ContentGeneration] JSON not found in response:', response.substring(0, 500));
          throw new Error('No JSON found in response');
        }

        const extracted = jsonMatch[1] || jsonMatch[0];

        try {
          jsonData = JSON.parse(extracted);
        } catch (extractParseError) {
          console.log('[ContentGeneration] Extracted parse failed, trying manual fix...');

          // JSONの手動修正を試みる
          const fixedJson = this.fixMalformedJson(extracted);
          jsonData = JSON.parse(fixedJson);
        }
      }

      // 必須フィールドの検証
      if (!jsonData.content) {
        throw new Error('Missing required field: content');
      }

      // パース済みデータをログ出力
      console.log('\n[ContentGeneration] === パース済みデータ ===');
      console.log('content length:', jsonData.content.length);
      console.log('generatedSections:', jsonData.generatedSections || []);
      console.log('skippedSections:', jsonData.skippedSections || []);
      console.log('[ContentGeneration] === 詳細終了 ===\n');

      // デフォルト値を設定
      const allSections = template._sections?.order || ['lead', 'menu', 'novelty', 'goods', 'summary'];
      const generatedSections = jsonData.generatedSections || allSections;
      const skippedSections = jsonData.skippedSections || [];

      return {
        content: jsonData.content,
        generatedSections,
        skippedSections,
      };
    } catch (error) {
      console.error('[ContentGeneration] Failed to parse response:', error);
      throw new Error(
        `Failed to parse content generation response: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * シングルトンインスタンス（遅延初期化）
 */
let _contentGenerationService: ContentGenerationService | null = null;

export function getContentGenerationService(): ContentGenerationService {
  if (!_contentGenerationService) {
    _contentGenerationService = new ContentGenerationService();
  }
  return _contentGenerationService;
}

/**
 * @deprecated Use getContentGenerationService() instead
 */
export const contentGenerationService = {
  get instance() {
    return getContentGenerationService();
  },
  generateContent: (request: ContentGenerationRequest) =>
    getContentGenerationService().generateContent(request),
};
