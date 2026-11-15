/**
 * Record a `pnpm debug:mdx <URL>` run that makes a PR in the same attempt record the scheduled
 * job uses, so the job does not try that URL again (decided 2026-11-15). Dry runs, local runs
 * and article updates are not recorded; the caller only calls this for a PR-making run.
 *
 * Never throws: failing to record must not turn a finished run into a failure.
 *
 * @module lib/scheduled/record-cli-attempt
 */
import type { MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

import { buildAttemptRecord } from './attempt-record';
import type { AttemptStore } from './attempt-store';
import { extractPublishedDate } from './published-date';
import { toJstDateString } from '@/lib/utils/date';

import { normalizeAttemptUrl } from './attempt-url';

export async function recordCliAttempt(
  /** Called inside the try: building the store (Firebase Admin) can throw too */
  getStore: () => Pick<AttemptStore, 'get' | 'save'>,
  input: { url: string; title: string; pageHtml: string; result: MdxGenerationResult; now?: Date },
): Promise<void> {
  try {
    const store = getStore();
    const now = input.now ?? new Date();
    const url = normalizeAttemptUrl(input.url);
    const previous = await store.get(url);
    const record = buildAttemptRecord(
      previous,
      {
        url,
        source: 'cli',
        title: input.title,
        pageDate: extractPublishedDate(input.pageHtml, now),
        now,
      },
      { kind: 'pipeline', result: input.result },
      true,
    );
    if (!(await store.save(record))) {
      console.log('📒 試した URL の記録は変えませんでした (打ち切り済みの URL のため、定期実行は試しません)');
      return;
    }
    const next =
      record.status === 'waiting-details' && record.nextAttemptAt
        ? `定期実行は ${toJstDateString(record.nextAttemptAt)} 以降に試し直します`
        : record.status === 'retrying-failure'
          ? '定期実行が次の回に試し直します'
          : '定期実行はこの URL を試しません';
    console.log(`📒 試した URL として記録しました (${next})`);
  } catch (error) {
    console.warn(
      '⚠️ 試した URL の記録に失敗しました (記事の生成の結果には影響しません):',
      error instanceof Error ? error.message : String(error),
    );
  }
}
