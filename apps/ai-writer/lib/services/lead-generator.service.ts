/**
 * @fileoverview LeadGeneratorService (Sprint C-β P11)
 *
 * @description
 * リード文専用パイプライン。`01-lead.yaml` のテンプレート辞書を機械的に評価し、
 * 4 スロット構造 (`[主体]+[接続動詞]+[形容詞]+[メディア形態]+「作品名」`) を
 * rule-driven に組み立てる。テンプレート未 hit / 未置換変数閾値超え時は LLM Fallback。
 *
 * Sprint C-β P11 の中核。既存の `4-content.yaml` (LLM で MDX 全体生成) から
 * lead セクションを切り出し、TypeScript 側で決定的に生成する。
 *
 * ## 設計判断 (Plan `docs/plan/sprint-c/2026-07-19-*-phase-2d-*.md` 準拠)
 *
 * - D1: Condition 評価は hand-maintained predicate table (自然言語 parser 実装は YAGNI)
 * - D2: テンプレート置換は既存 `TextPlaceholderReplacerService.replaceAll()` を DI で再利用
 * - D3: 4 スロット抽出は template id → slot mapping table (静的定義、regression 用)
 * - D4: LLM Fallback は Sprint C-β P0 の `responseSchema` pattern を活用
 * - D5: `AiProvider` は optional injection、Fallback 発火時のみ利用
 * - D6: YAML ロードは Singleton 内独立 loader (js-yaml lazy load、既存 YamlTemplateLoaderService は over-fetch)
 * - D7: `AiProvider` 未 DI 時は `lead_generic` テンプレを強制採用 (throw しない)
 *
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/sections/01-lead.yaml (v3.3.0、canonical spec)
 * @see revolution/shared/schemas/lead-response.ts (LeadGeneratorResult contract)
 * @since Sprint C-β P11 (2026-07-19)
 */

import * as fs from 'fs';
import * as path from 'path';

import yaml from 'js-yaml';

import {
  LEAD_FALLBACK_TEMPLATE_ID,
  LeadSlotsSchema,
  type LeadFallbackReason,
  type LeadGeneratorResult,
  type LeadSlots,
} from '@revolution/schemas/lead-response';

import type { AiProvider } from '../ai/providers/ai-provider.interface';
import type { SectionTemplate } from '../types/modular-template';
// Sprint C-β P11 Phase 2f (2026-07-19): LLM Fallback path で使用
import { zodToOpenAiSchema } from '../utils/zod-to-openai-schema';

import type { MediaFormResolverService } from './media-form-resolver.service';
import type { MediaTypeMapperService } from './media-type-mapper.service';
import type {
  EventPeriod,
  StoreInfo,
  TextPlaceholderData,
  TextPlaceholderReplacerService,
  WorkInfo,
} from './text-placeholder-replacer.service';

// Re-export helper (author-formatter) は private method 化のため internal impl で import
import { formatAuthorName, hasMultipleAuthors } from '../utils/author-formatter';

/**
 * LeadGeneratorService の入力データ。
 * `TextPlaceholderData` と互換 (extraction.service の output と結合可能)。
 */
export interface LeadGeneratorInput {
  // 必須
  works: WorkInfo[];
  store: StoreInfo;
  開催期間: EventPeriod;

  // primary 作品情報 (2-extraction の output、optional で null 許容)
  メディアタイプ?: string;
  原作タイプ?: string;
  原作者有無?: boolean;

  // オプション
  原作者名?: string | string[] | null;
  キャラクター名?: string[] | null;
  スタジオ名?: string | null;
  監督名?: string | null;
  シリーズ名?: string | null;
  テーマ名?: string | null;
  ノベルティ名?: string | null;
  グッズ名?: string[] | null;

  // 後方互換用 (省略可、内部で作品名/店舗名として使用)
  作品名?: string;
  店舗名?: string;
  略称?: string | null;
  公式サイトURL?: string | null;
}

/**
 * LeadGeneratorService の依存関係 (Constructor Injection)。
 */
export interface LeadGeneratorDeps {
  mediaFormResolver: MediaFormResolverService;
  mediaTypeMapper: MediaTypeMapperService;
  textReplacer: TextPlaceholderReplacerService;
  /** LLM Fallback 発火時のみ利用。未指定なら `lead_generic` を強制採用。 */
  aiProvider?: AiProvider;
  /** test 用、default = apps/ai-writer/templates/collabo-cafe/sections/01-lead.yaml */
  yamlPath?: string;
}

/**
 * `derivedVars` 計算後の enriched data。predicate + slot definition から参照される。
 * `TextPlaceholderData` を拡張しつつ、`LeadGeneratorInput` の optional field
 * (`スタジオ名` / `監督名` / `シリーズ名`) と、計算済み派生変数を包含する。
 */
export interface EnrichedData extends TextPlaceholderData {
  // LeadGeneratorInput 由来の optional (TextPlaceholderData には未定義)
  スタジオ名?: string | null;
  監督名?: string | null;
  シリーズ名?: string | null;

  // computeDerivedVariables で計算される派生 field (全て required 化)
  primary_work: WorkInfo;
  secondary_works: WorkInfo[];
  is_multi_work: boolean;
  has_studio_name: boolean;
  has_director_name: boolean;
  has_series_name: boolean;
  作品名: string;
  店舗名: string;

  // §6.2 対訳マップの解決結果 (P11 新規)
  メディア形態表記: string;
  member_separator: string;
  メディアタイプ_label: string;
  is_idol_or_utaite: boolean;
  原作者名_formatted: string;
  has_multiple_authors: boolean;
}

// ============================================================================
// LeadGeneratorService
// ============================================================================

export class LeadGeneratorService {
  private readonly deps: LeadGeneratorDeps;
  private leadSection: SectionTemplate | null = null;

  constructor(deps: LeadGeneratorDeps) {
    this.deps = deps;
  }

  /**
   * リード文を生成する (rule-driven + optional LLM Fallback)。
   *
   * @param input 抽出済み記事情報 (works / store / 開催期間 + オプション各種)
   * @returns leadMdx + usedTemplate + slots (+ fallbackReason if Fallback fired)
   */
  async generate(input: LeadGeneratorInput): Promise<LeadGeneratorResult> {
    const section = this.getLeadSection();
    const enriched = this.computeEnrichedData(input);

    // Step 0: works[] 空 + 作品名 未指定の early guard (R1 Minor)
    //   `works=[]` かつ `input.作品名` が未指定/空文字の場合、`workTitle=''` で
    //   「人気漫画「」」のような壊れた出力が生成される。この state は rule miss よりも
    //   前段の入力データ欠損を示すため、rule 評価前に fallback へ委譲する
    //   (LLM Fallback が DI 済みなら LLM が自由生成で救う、static Fallback なら
    //   lead_generic 強制採用で「作品」literal を使う)。
    if (!enriched.primary_work.title || enriched.primary_work.title.trim() === '') {
      return this.fallback(enriched, 'empty_work_title');
    }

    // Step 1: 条件分岐を配列順に評価
    const matchedCondition = section.conditions?.find((cond) => {
      const predicate = CONDITION_PREDICATES[cond.id];
      return predicate?.(enriched) ?? false;
    });
    const usedTemplate = matchedCondition?.template ?? 'lead_generic';

    // Step 2: 対応 template 文字列を lookup
    const templateStr = section.templates[usedTemplate];
    if (!templateStr) {
      return this.fallback(enriched, 'template_render_error');
    }

    // Step 3: {{変数}} 置換 (TextPlaceholderReplacer を DI 経由で再利用)
    const replacement = this.deps.textReplacer.replaceAll(
      templateStr,
      enriched as TextPlaceholderData
    );

    // Step 4: 4 スロット抽出
    const slotDef = SLOT_DEFINITIONS[usedTemplate] ?? SLOT_DEFINITIONS.lead_generic;
    const slots = slotDef!(enriched);

    // Step 5: Fallback 条件チェック
    if (replacement.unreplacedPlaceholders.length >= 3) {
      return this.fallback(enriched, 'too_many_unreplaced_placeholders');
    }
    if (!replacement.content.trim()) {
      return this.fallback(enriched, 'output_empty');
    }
    if (replacement.content.length < 20) {
      return this.fallback(enriched, 'output_too_short');
    }

    return {
      leadMdx: replacement.content,
      usedTemplate,
      slots,
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * 01-lead.yaml を lazy load (初回のみ)。以降は cache 済み SectionTemplate を返す。
   */
  private getLeadSection(): SectionTemplate {
    if (this.leadSection) return this.leadSection;

    const defaultPath = path.join(
      process.cwd(),
      'templates',
      'collabo-cafe',
      'sections',
      '01-lead.yaml'
    );
    const yamlPath = this.deps.yamlPath ?? defaultPath;

    if (!fs.existsSync(yamlPath)) {
      throw new Error(
        `Lead section YAML not found: ${yamlPath}\n` +
          'Please ensure the Templates repository has been synced via `pnpm sync:templates`.'
      );
    }

    const fileContent = fs.readFileSync(yamlPath, 'utf-8');
    const parsed = yaml.load(fileContent) as SectionTemplate;

    if (!parsed?.templates || !parsed?.section) {
      throw new Error(
        `Invalid lead section YAML at ${yamlPath}: missing 'templates' or 'section' field.`
      );
    }

    this.leadSection = parsed;
    return parsed;
  }

  /**
   * TextPlaceholderReplacer.computeDerivedVariables 相当のロジックを再現。
   * 全 derived vars を含む EnrichedData を返す (predicate + slot definition から参照)。
   */
  private computeEnrichedData(input: LeadGeneratorInput): EnrichedData {
    const works = input.works ?? [];
    const primary_work = works.find((w) => w.is_primary) ?? works[0] ?? {
      title: input.作品名 ?? '',
      is_primary: true,
    };
    const secondary_works = works.filter((w) => !w.is_primary);
    const is_multi_work = works.length >= 2;

    const 作品名 = input.作品名 ?? primary_work.title;
    const 店舗名 = input.店舗名 ?? input.store?.name ?? '';

    const has_studio_name = !!input.スタジオ名;
    const has_director_name = !!input.監督名;
    const has_series_name = !!input.シリーズ名;

    // §6.2 対訳マップ (LeadGenerator 独自、他 service との整合は Layer 1 test で verify)
    const メディア形態表記 = this.deps.mediaFormResolver.resolve(
      input.原作タイプ,
      input.メディアタイプ
    );
    const member_separator = this.deps.mediaTypeMapper.getSeparator(
      input.メディアタイプ ?? ''
    );
    const メディアタイプ_label = this.deps.mediaTypeMapper.getLabel(
      input.メディアタイプ ?? ''
    );
    const is_idol_or_utaite = this.deps.mediaTypeMapper.isIdolOrUtaite(
      input.メディアタイプ ?? ''
    );

    const 原作者名_formatted = formatAuthorName(input.原作者名 ?? null);
    const has_multiple_authors = hasMultipleAuthors(input.原作者名 ?? null);

    // コラボ作品名 (テーブル表示用)
    const コラボ作品名 =
      works.length === 1
        ? works[0].title
        : works.map((w) => w.title).join(' × ') || 作品名;

    return {
      ...input,
      作品名,
      店舗名,
      works,
      store: input.store,
      開催期間: input.開催期間,
      primary_work,
      secondary_works,
      is_multi_work,
      has_studio_name,
      has_director_name,
      has_series_name,
      メディア形態表記,
      member_separator,
      メディアタイプ_label,
      is_idol_or_utaite,
      原作者名_formatted,
      has_multiple_authors,
      コラボ作品名,
    };
  }

  /**
   * Fallback 発火時の処理 (Sprint C-β P11 Phase 2d/2f)。
   *
   * - AiProvider 未 DI (D7): `lead_generic` テンプレを強制採用 (throw しない、static path)
   * - AiProvider DI 済み: LLM 呼び出しで 4 スロット JSON を strict mode 生成 (Sprint C-β P0 pattern)
   */
  async fallback(
    enriched: EnrichedData,
    reason: LeadFallbackReason
  ): Promise<LeadGeneratorResult> {
    if (this.deps.aiProvider) {
      return this.llmFallback(enriched, reason);
    }
    return this.staticFallback(enriched, reason);
  }

  /**
   * AiProvider 未 DI 時の static fallback: `lead_generic` テンプレを強制採用。
   */
  private staticFallback(
    enriched: EnrichedData,
    reason: LeadFallbackReason
  ): LeadGeneratorResult {
    const section = this.getLeadSection();
    const templateStr = section.templates.lead_generic;

    if (process.env.DEBUG_LEAD_GENERATOR === 'true') {
      console.warn(
        `[LeadGenerator] Static fallback fired: reason=${reason}, using lead_generic (aiProvider not injected)`
      );
    }

    if (!templateStr) {
      // 万一 lead_generic も欠落している場合の hard fallback (通常発生しない)
      return {
        leadMdx: `人気作品「${enriched.作品名}」× ${enriched.店舗名}にてコラボカフェが開催される。`,
        usedTemplate: LEAD_FALLBACK_TEMPLATE_ID,
        fallbackReason: reason,
        slots: SLOT_DEFINITIONS.lead_generic!(enriched),
      };
    }

    const replacement = this.deps.textReplacer.replaceAll(
      templateStr,
      enriched as TextPlaceholderData
    );

    return {
      leadMdx: replacement.content,
      usedTemplate: LEAD_FALLBACK_TEMPLATE_ID,
      fallbackReason: reason,
      slots: SLOT_DEFINITIONS.lead_generic!(enriched),
    };
  }

  /**
   * AiProvider DI 済み時の LLM fallback: `LeadSlotsSchema` を strict mode で強制生成し、
   * 4 スロットから汎用テンプレで MDX を組み立てる。
   *
   * Sprint C-β P0 pattern を再利用 (`zodToOpenAiSchema` + `sendMessage.responseSchema`)。
   */
  private async llmFallback(
    enriched: EnrichedData,
    reason: LeadFallbackReason
  ): Promise<LeadGeneratorResult> {
    const prompt = this.buildFallbackPrompt(enriched, reason);
    const schemaPayload = zodToOpenAiSchema(LeadSlotsSchema, 'LeadSlotsResponse');

    if (process.env.DEBUG_LEAD_GENERATOR === 'true') {
      console.warn(
        `[LeadGenerator] LLM fallback fired: reason=${reason}, invoking AiProvider.sendMessage() with responseSchema=${schemaPayload.name}`
      );
    }

    const response = await this.deps.aiProvider!.sendMessage(prompt, {
      temperature: 0.3,
      responseFormat: 'json',
      responseSchema: schemaPayload,
    });

    // Zod strict parse: LLM 応答が LeadSlots schema に準拠していることを検証
    const parsed = LeadSlotsSchema.parse(JSON.parse(response.content));
    const leadMdx = this.slotsToMdx(parsed, enriched);

    return {
      leadMdx,
      usedTemplate: LEAD_FALLBACK_TEMPLATE_ID,
      fallbackReason: reason,
      slots: parsed,
    };
  }

  /**
   * LLM Fallback 用の prompt を組み立てる。4 スロット構造を JSON で強制生成させる指示。
   */
  private buildFallbackPrompt(enriched: EnrichedData, reason: LeadFallbackReason): string {
    const 作品名リスト = enriched.works.map((w) => w.title).join(' × ');
    return [
      'あなたは日本語のコラボカフェ記事のリード文を生成する専門 AI です。',
      '',
      '# 出力仕様 (Sprint C-β P11、4 スロット構造)',
      '- agent (主体): 原作者名 / スタジオ名 / 監督名など、null 可',
      '- verb (接続動詞): 「による」「が手掛ける」など、null 可',
      '- adjective (形容詞): 「人気」「大人気」「世界中で愛される」など、null 可 (デフォルト「人気」)',
      '- mediaForm (メディア形態、必須): §6.2 対訳マップ準拠の日本語表記 (「漫画」「ライトノベル」「アニメ映画」「キャラクター」「バーチャル・シンガー」等)',
      '- workTitle (作品名、必須): primary 作品名',
      '',
      '# 入力情報',
      `- 作品名: ${enriched.作品名}`,
      `- 店舗名: ${enriched.店舗名}`,
      `- メディアタイプ: ${enriched.メディアタイプ ?? '(未指定)'}`,
      `- 原作タイプ: ${enriched.原作タイプ ?? '(未指定)'}`,
      `- 原作者名: ${enriched.原作者名_formatted || '(なし)'}`,
      `- キャラクター名: ${enriched.キャラクター名?.join('、') ?? '(なし)'}`,
      `- §6.2 対訳マップ解決済のメディア形態表記: ${enriched.メディア形態表記}`,
      `- 複数作品コラボ: ${enriched.is_multi_work ? `はい (${作品名リスト})` : 'いいえ'}`,
      '',
      `# Fallback 発火理由 (デバッグ)\n${reason}`,
      '',
      '# 出力形式',
      'JSON schema LeadSlotsResponse に厳密に準拠して返してください。',
      '{ "agent": string|null, "verb": string|null, "adjective": string|null, "mediaForm": string (非空), "workTitle": string (非空) }',
    ].join('\n');
  }

  /**
   * LLM が返した 4 スロットから MDX リード文を組み立てる (2 段落想定)。
   */
  private slotsToMdx(slots: LeadSlots, enriched: EnrichedData): string {
    const agentPart = slots.agent ? `${slots.agent}${slots.verb ?? ''}` : '';
    const adjPart = slots.adjective ?? '人気';
    const 開催期間str = this.format開催期間(enriched.開催期間);
    const firstSentence = `${agentPart}${adjPart}${slots.mediaForm}「${slots.workTitle}」× ${enriched.店舗名}にて${開催期間str}コラボカフェが開催される。`;
    const secondSentence = `「${slots.workTitle}」コラボカフェでは、コラボメニューやグッズがお楽しみいただける。`;
    return `${firstSentence}\n\n${secondSentence}`;
  }

  /**
   * 開催期間を日本語表記に変換 (同年 / 年またぎ / 終了未定)。
   */
  private format開催期間(period: EventPeriod): string {
    const 開始 = `${period.開始.年}${period.開始.日付}`;
    if (period.終了.未定) return `${開始}より`;
    if (period.終了.年 == null || period.終了.日付 == null) return `${開始}より`;
    if (period.開始.年 === period.終了.年) return `${開始}〜${period.終了.日付}まで`;
    return `${開始}〜${period.終了.年}${period.終了.日付}まで`;
  }
}

// ============================================================================
// Condition predicate table (Phase 2d-4)
//
// 01-lead.yaml の conditions[] 配列と 1:1 対応。YAML 側の自然言語 condition
// (例: "原作者有無 === true かつ テーマ名 が存在する かつ キャラクター名 が存在する") を
// hand-maintained TS predicate で機械評価する。
//
// 評価順序は 01-lead.yaml conditions[] の配列順が正 (LeadGenerator が iterate 時に順序を尊重)。
// ============================================================================

type ConditionPredicate = (data: EnrichedData) => boolean;

const CONDITION_PREDICATES: Record<string, ConditionPredicate> = {
  // ========================================
  // 複数作品コラボ (最優先、is_multi_work === true)
  // ========================================
  lead_multi_work_anime_x_character: (d) =>
    d.is_multi_work &&
    ['anime', 'anime_movie', 'manga'].includes(d.メディアタイプ ?? ''),
  // NOTE: 01-lead.yaml では "secondary_works[0] がキャラクターブランド" も要件だが、
  // works[] は現状 title + is_primary のみで secondary メディアタイプ情報を保持しない。
  // 実運用では primary が anime/manga で is_multi_work なら本パターンに match させる
  // (secondary の判定は Sprint 拡張時に別 field 追加で対応)。

  lead_multi_work_character_x_character: (d) =>
    d.is_multi_work && d.メディアタイプ === 'character',

  lead_multi_work_generic: (d) => d.is_multi_work,

  // ========================================
  // 単一作品 - 原作者あり
  // ========================================
  lead_author_with_theme_and_characters: (d) =>
    d.原作者有無 === true &&
    !!d.テーマ名 &&
    (d.キャラクター名?.length ?? 0) > 0,

  lead_author_with_characters: (d) =>
    d.原作者有無 === true && (d.キャラクター名?.length ?? 0) > 0,

  lead_author_only: (d) => d.原作者有無 === true,

  // ========================================
  // 単一作品 - 原作者なし + メディアタイプ別
  // ========================================
  lead_game_with_characters: (d) =>
    d.原作者有無 === false &&
    d.メディアタイプ === 'game' &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_game_generic: (d) =>
    d.原作者有無 === false && d.メディアタイプ === 'game',

  lead_vtuber: (d) => d.原作者有無 === false && d.メディアタイプ === 'vtuber',
  lead_youtuber: (d) => d.原作者有無 === false && d.メディアタイプ === 'youtuber',
  lead_idol: (d) => d.原作者有無 === false && d.メディアタイプ === 'idol',
  lead_voice_actor: (d) =>
    d.原作者有無 === false && d.メディアタイプ === 'voice_actor',

  lead_movie_with_characters: (d) =>
    d.原作者有無 === false &&
    d.メディアタイプ === 'movie' &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_movie_generic: (d) =>
    d.原作者有無 === false && d.メディアタイプ === 'movie',

  lead_tokusatsu_with_characters: (d) =>
    d.原作者有無 === false &&
    d.メディアタイプ === 'tokusatsu' &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_tokusatsu_generic: (d) =>
    d.原作者有無 === false && d.メディアタイプ === 'tokusatsu',

  // ========================================
  // オリジナルアニメ (スタジオ名/監督名/シリーズ名 対応、優先度順)
  // ========================================
  lead_studio_director_series_with_characters: (d) =>
    d.原作者有無 === false &&
    d.原作タイプ === 'original_anime' &&
    d.has_studio_name &&
    d.has_director_name &&
    d.has_series_name &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_studio_director_series: (d) =>
    d.原作者有無 === false &&
    d.原作タイプ === 'original_anime' &&
    d.has_studio_name &&
    d.has_director_name &&
    d.has_series_name,

  lead_studio_director_with_characters: (d) =>
    d.原作者有無 === false &&
    d.原作タイプ === 'original_anime' &&
    d.has_studio_name &&
    d.has_director_name &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_studio_director: (d) =>
    d.原作者有無 === false &&
    d.原作タイプ === 'original_anime' &&
    d.has_studio_name &&
    d.has_director_name,

  lead_studio_with_characters: (d) =>
    d.原作者有無 === false &&
    ['original_anime', 'studio_production', 'other'].includes(d.原作タイプ ?? '') &&
    d.has_studio_name &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_studio: (d) =>
    d.原作者有無 === false &&
    ['original_anime', 'studio_production', 'other'].includes(d.原作タイプ ?? '') &&
    d.has_studio_name,

  lead_director_with_characters: (d) =>
    d.原作者有無 === false &&
    ['original_anime', 'other'].includes(d.原作タイプ ?? '') &&
    d.has_director_name &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_director: (d) =>
    d.原作者有無 === false &&
    ['original_anime', 'other'].includes(d.原作タイプ ?? '') &&
    d.has_director_name,

  // オリジナルアニメ fallback (スタジオ/監督なし)
  lead_original_anime_with_characters: (d) =>
    d.原作者有無 === false &&
    d.原作タイプ === 'original_anime' &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_original_anime_generic: (d) =>
    d.原作者有無 === false && d.原作タイプ === 'original_anime',

  // ボーカロイド
  lead_vocaloid_with_characters: (d) =>
    d.原作者有無 === false &&
    d.メディアタイプ === 'vocaloid' &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_vocaloid_generic: (d) =>
    d.原作者有無 === false && d.メディアタイプ === 'vocaloid',

  // キャラクターブランド (character、単一作品)
  lead_character_with_characters: (d) =>
    d.原作者有無 === false &&
    d.メディアタイプ === 'character' &&
    (d.キャラクター名?.length ?? 0) > 0,
  lead_character_generic: (d) =>
    d.原作者有無 === false && d.メディアタイプ === 'character',

  // 汎用 fallback (最下位)
  lead_generic_with_characters: (d) => (d.キャラクター名?.length ?? 0) > 0,
  lead_generic: () => true, // 最終 catch-all
};

// ============================================================================
// テンプレート id → 4 スロット抽出 table (Phase 2d-5)
//
// 各テンプレートで [主体][接続動詞][形容詞][メディア形態]「作品名」の 4 スロット +
// workTitle を静的定義。regression assertion 用に slots object を返却する。
// ============================================================================

type SlotDefinition = (d: EnrichedData) => LeadSlots;

const SLOT_DEFINITIONS: Record<string, SlotDefinition> = {
  // ========================================
  // 原作者あり
  // ========================================
  lead_author_with_theme_and_characters: (d) => ({
    agent: d.原作者名_formatted || null,
    verb: 'による',
    adjective: '人気',
    mediaForm: d.メディア形態表記,
    workTitle: d.作品名,
  }),
  lead_author_with_characters: (d) => ({
    agent: d.原作者名_formatted || null,
    verb: 'による',
    adjective: '人気',
    mediaForm: d.メディア形態表記,
    workTitle: d.作品名,
  }),
  lead_author_only: (d) => ({
    agent: d.原作者名_formatted || null,
    verb: 'による',
    adjective: '人気',
    mediaForm: d.メディア形態表記,
    workTitle: d.作品名,
  }),

  // ========================================
  // メディアタイプ別 (原作者なし)
  // ========================================
  lead_game_with_characters: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: 'ゲーム',
    workTitle: d.作品名,
  }),
  lead_game_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: 'ゲーム',
    workTitle: d.作品名,
  }),
  lead_vtuber: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: 'VTuber',
    workTitle: d.作品名,
  }),
  lead_youtuber: (d) => ({
    agent: null,
    verb: null,
    adjective: 'YouTubeで人気を誇る',
    mediaForm: 'YouTuber',
    workTitle: d.作品名,
  }),
  lead_idol: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: 'アイドル',
    workTitle: d.作品名,
  }),
  lead_voice_actor: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: '声優',
    workTitle: d.作品名,
  }),
  lead_movie_with_characters: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: '映画',
    workTitle: d.作品名,
  }),
  lead_movie_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: '映画',
    workTitle: d.作品名,
  }),
  lead_tokusatsu_with_characters: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: '特撮作品',
    workTitle: d.作品名,
  }),
  lead_tokusatsu_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: '特撮作品',
    workTitle: d.作品名,
  }),

  // ========================================
  // オリジナルアニメ (スタジオ/監督/シリーズ)
  // ========================================
  lead_studio_director_series_with_characters: (d) => ({
    agent: `${d.監督名 ?? ''}監督と${d.スタジオ名 ?? ''}制作で贈る`,
    verb: null,
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_studio_director_series: (d) => ({
    agent: `${d.監督名 ?? ''}監督と${d.スタジオ名 ?? ''}制作で贈る`,
    verb: null,
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_studio_director_with_characters: (d) => ({
    agent: `${d.監督名 ?? ''}監督と${d.スタジオ名 ?? ''}制作で贈る`,
    verb: null,
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_studio_director: (d) => ({
    agent: `${d.監督名 ?? ''}監督と${d.スタジオ名 ?? ''}制作で贈る`,
    verb: null,
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_studio_with_characters: (d) => ({
    agent: d.スタジオ名 ?? null,
    verb: 'が手掛ける',
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_studio: (d) => ({
    agent: d.スタジオ名 ?? null,
    verb: 'が手掛ける',
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_director_with_characters: (d) => ({
    agent: `${d.監督名 ?? ''}監督`,
    verb: 'が手掛ける',
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_director: (d) => ({
    agent: `${d.監督名 ?? ''}監督`,
    verb: 'が手掛ける',
    adjective: '大人気',
    mediaForm: 'アニメ',
    workTitle: d.作品名,
  }),
  lead_original_anime_with_characters: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: 'オリジナルアニメ',
    workTitle: d.作品名,
  }),
  lead_original_anime_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: 'オリジナルアニメ',
    workTitle: d.作品名,
  }),

  // ========================================
  // ボーカロイド / キャラクターブランド
  // ========================================
  lead_vocaloid_with_characters: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: d.メディア形態表記, // '「初音ミク」' 等ではメディア形態を明示しないため、対訳マップ値
    workTitle: d.作品名,
  }),
  lead_vocaloid_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: d.メディア形態表記,
    workTitle: d.作品名,
  }),
  lead_character_with_characters: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: 'キャラクター',
    workTitle: d.作品名,
  }),
  lead_character_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: 'キャラクター',
    workTitle: d.作品名,
  }),

  // ========================================
  // 汎用 fallback
  // ========================================
  lead_generic_with_characters: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: d.メディア形態表記,
    workTitle: d.作品名,
  }),
  lead_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気',
    mediaForm: d.メディア形態表記,
    workTitle: d.作品名,
  }),

  // ========================================
  // 複数作品コラボ
  // ========================================
  lead_multi_work_anime_x_character: (d) => ({
    agent: d.原作者名_formatted || null,
    verb: 'による',
    adjective: '人気作品',
    mediaForm: d.メディア形態表記,
    workTitle: d.primary_work?.title ?? d.作品名,
  }),
  lead_multi_work_character_x_character: (d) => ({
    agent: null,
    verb: null,
    adjective: '人気キャラクター',
    mediaForm: 'キャラクター',
    workTitle: d.primary_work?.title ?? d.作品名,
  }),
  lead_multi_work_generic: (d) => ({
    agent: null,
    verb: null,
    adjective: null,
    mediaForm: d.メディア形態表記,
    workTitle: d.primary_work?.title ?? d.作品名,
  }),
};

// ============================================================================
// Singleton (既存 MediaTypeMapperService / MediaFormResolverService と同 pattern)
// ============================================================================

let leadGeneratorInstance: LeadGeneratorService | null = null;

/**
 * LeadGeneratorService の singleton getter。
 *
 * ⚠️ **重要 (footgun)**: `deps` は **最初の呼び出しでのみ** consumed され、以降の
 * 呼び出しでは cache 済 instance が返るため引数が**無視される**。特に `aiProvider` を
 * 後から差し替える場合、必ず先に `resetLeadGeneratorService()` を呼ぶこと (テスト間で
 * DI する時などが該当)。既存 MediaTypeMapperService / MediaFormResolverService は
 * factory 引数を取らない singleton だが、本 service は per-call `deps` を取る例外的
 * pattern のため、future request 毎に別 provider を注入したい要件が出た時点で
 * singleton pattern そのものを module-level deps 解決に組み替える判断が必要。
 */
export function getLeadGeneratorService(deps: LeadGeneratorDeps): LeadGeneratorService {
  if (!leadGeneratorInstance) {
    leadGeneratorInstance = new LeadGeneratorService(deps);
  }
  return leadGeneratorInstance;
}

/**
 * Singleton instance をリセット (テスト用)。
 * @internal
 */
export function resetLeadGeneratorService(): void {
  leadGeneratorInstance = null;
}

// Test hook: predicate + slot table を外部に公開 (実装 verify 用、production import 非推奨)
export const __INTERNAL_CONDITION_PREDICATES__ = CONDITION_PREDICATES;
export const __INTERNAL_SLOT_DEFINITIONS__ = SLOT_DEFINITIONS;
