/**
 * 検知リンク: WEB チェッカーの更新検知で新しく現れたリンクのうち、AI ライターに渡したもの。
 *
 * 書くのは WEB チェッカーの Functions (`apps/web-checker/functions`)、読むのは AI ライターの定期実行
 * (`apps/ai-writer/lib/scheduled`)。どちらも Admin SDK で、クライアントからは読み書きできない (rules に書かない)。
 * ドキュメント ID は正規化した URL の SHA-256 (`@revolution/net/attempt-url` の `attemptDocId`) で、
 * AI ライターの「試した URL」・登録 URL と同じ ID になる。
 *
 * 状態は `pending` (まだ試していない) → `tried` (定期実行が試した) か `expired` (検知から 30 日、試さないまま)。
 * 同じ URL を 2 度試さないのは、AI ライターの「試した URL」の記録が受け持つ。
 *
 * @module @revolution/schemas/detected-link
 */
import { z } from 'zod';

export const DETECTED_LINKS_COLLECTION = 'web_checker_detected_links';

/** 検知から何日で候補から外すか (公式サイトへの掲載が遅れても、掲載された時に検知するので、数えるのは検知から) */
export const DETECTED_LINK_TTL_DAYS = 30;

export const DetectedLinkStatusSchema = z.enum(['pending', 'tried', 'expired']);
export type DetectedLinkStatus = z.infer<typeof DetectedLinkStatusSchema>;

export const DetectedLinkSchema = z.object({
  /** 正規化した URL (`normalizeAttemptUrl`) */
  url: z.string().min(1),
  /** どの監視対象の更新検知で現れたか */
  targetId: z.string(),
  targetTitle: z.string(),
  /** 検知した日時 (ms の epoch) */
  detectedAt: z.number().int(),
  status: DetectedLinkStatusSchema,
});
export type DetectedLink = z.infer<typeof DetectedLinkSchema>;
