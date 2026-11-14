/**
 * Decides how `pnpm debug:mdx <URL>` builds an article when the URL is an archive article:
 * from the official site when it is still there, or from the archive article when it is gone.
 *
 * @module lib/archive-source/plan-run
 */
import type { RssExtractionResult } from '@/lib/ai/providers/ai-provider.interface';
import type { MdxSourceOverride } from '@/lib/services/article-generation-mdx.service';

import { buildArchivePageContent } from './archive-content';
import { type ArchiveSource, findArchiveSource } from './config';
import { type ArchiveArticle, type FetchJson, resolveArchiveArticle } from './resolve-article';
import { type FetchContent, type OfficialSiteGoneReason, probeOfficialSite } from './probe-official';

/**
 * Why the archive article is the source: the official site is gone, or it is still there but no
 * longer lists the event's menu, goods or novelty (ended events often lose them)
 */
export type ArchiveReason = OfficialSiteGoneReason | 'official-has-no-items';

export interface ArchiveModePlan {
  mode: 'archive';
  article: ArchiveArticle;
  /** The archive article: the pipeline reads its title and text */
  inputUrl: string;
  eventYear?: number;
  reason: ArchiveReason;
  detail: string;
  sourceOverride: MdxSourceOverride;
  /** Work / store / event type read from the archive article (reused so the pipeline does not ask again) */
  extracted: Pick<RssExtractionResult, 'workTitle' | 'storeName' | 'eventTypeName'>;
}

export type ArchiveRunPlan =
  | {
      mode: 'official';
      article: ArchiveArticle;
      /** The official site: the pipeline's input, exactly as for a URL given by hand */
      inputUrl: string;
      eventYear?: number;
      /** Used when the run from the official site skips the event as unannounced */
      fallback: ArchiveModePlan;
    }
  | ArchiveModePlan;

export interface PlanArchiveRunDeps {
  sources: readonly ArchiveSource[];
  fetchContent: FetchContent;
  /** Reads the work title from the archive article (the pipeline's rss-extraction) */
  extractWork: (input: { title: string; content: string; link: string }) => Promise<RssExtractionResult>;
  fetchJson?: FetchJson;
}

/** Returns null when the URL is not an archive article. Throws when the article has no official site URL */
export async function planArchiveRun(url: string, deps: PlanArchiveRunDeps): Promise<ArchiveRunPlan | null> {
  const source = findArchiveSource(url, deps.sources);
  if (!source) return null;

  const article = await resolveArchiveArticle(url, source, deps.fetchJson);
  const officialUrl = article.officialUrl;
  if (!officialUrl) {
    throw new Error('The archive article has no official site URL');
  }
  const eventYear = article.eventYear ?? undefined;

  const work = await deps.extractWork({ title: article.title, content: article.contentHtml, link: url });
  const probe = await probeOfficialSite(officialUrl, work.workTitle, deps.fetchContent);
  const archivePlan = (reason: ArchiveReason, detail: string): ArchiveModePlan => {
    const page = buildArchivePageContent(article.contentHtml, url, source, article.eventType);
    return {
      mode: 'archive',
      article,
      inputUrl: url,
      eventYear,
      reason,
      detail,
      sourceOverride: {
        officialUrl,
        contentHtml: page.contentHtml,
        ogImage: article.featuredImageUrl,
        categoryImages: page.categoryImages,
        reason,
        // A site that is alive but lost the items is still the event's page; a gone site is not linked
        linkOfficialSite: reason === 'official-has-no-items',
      },
      extracted: { workTitle: work.workTitle, storeName: work.storeName, eventTypeName: work.eventTypeName },
    };
  };

  if (probe.status === 'gone') return archivePlan(probe.reason, probe.detail);
  return {
    mode: 'official',
    article,
    inputUrl: officialUrl,
    eventYear,
    fallback: archivePlan('official-has-no-items', 'the official site no longer lists the menu, goods or novelty'),
  };
}
