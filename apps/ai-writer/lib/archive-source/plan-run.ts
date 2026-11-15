/**
 * Decides how `pnpm debug:mdx <URL>` builds an article when the URL is an archive article:
 * from the official site when it is still there, or from the archive article when it is gone.
 *
 * @module lib/archive-source/plan-run
 */
import type { RssExtractionResult } from '@/lib/ai/providers/ai-provider.interface';
import type {
  MdxGenerationRequest,
  MdxGenerationResult,
  MdxSourceOverride,
} from '@/lib/services/article-generation-mdx.service';

import { buildArchivePageContent } from './archive-content';
import { type ArchiveSource, findArchiveSource } from './config';
import { type ArchiveArticle, type FetchJson, resolveArchiveArticle } from './resolve-article';
import { type FetchContent, type OfficialSiteGoneReason, probeOfficialSite, siteUnreachable } from './probe-official';

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
    // A site that is alive but lost the items is still the event's page; a gone site is not linked
    const unlinkScope: MdxSourceOverride['unlinkScope'] = reason === 'official-has-no-items' ? 'none' : siteUnreachable(reason) ? 'host' : 'page';
    const closedSite = unlinkScope === 'none' ? undefined : { url: officialUrl, scope: unlinkScope };
    // The archive's own URL: images are kept only when they are on the same site as the article
    const page = buildArchivePageContent(article.contentHtml, article.articleUrl, source, article.eventType, closedSite);
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
        unlinkScope,
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

/** The page a pipeline run reads, as `extractArticleData` returns it */
export interface ArticlePage {
  title: string;
  html: string;
  actualUrl: string;
}

/** The pipeline input for a page (`pubDate` is the run time unless given) */
export function rssItemFromPage(page: ArticlePage, pubDate: string = new Date().toISOString()): MdxGenerationRequest['rssItem'] {
  return { title: page.title, link: page.actualUrl, content: page.html, contentSnippet: page.html.substring(0, 500), pubDate };
}

/**
 * Runs the pipeline for a request built from an archive plan. When it was built from the official
 * site and stopped as unannounced (ended events often lose their items there), it is built again
 * from the archive article (`plan.fallback`)
 */
export async function generateWithArchiveFallback(
  plan: ArchiveRunPlan | null,
  request: MdxGenerationRequest,
  generate: (request: MdxGenerationRequest) => Promise<MdxGenerationResult>,
  readPage: (url: string) => Promise<ArticlePage>,
): Promise<MdxGenerationResult> {
  const result = await generate(request);
  if (plan?.mode !== 'official' || result.skipKind !== 'unannounced-event') return result;

  const { fallback } = plan;
  console.log(`\n🗄️  公式サイトから作れなかったため (${result.skipReason})、アーカイブの記事から作り直します\n`);
  return generate({
    ...request,
    rssItem: rssItemFromPage(await readPage(fallback.inputUrl), request.rssItem.pubDate),
    sourceOverride: fallback.sourceOverride,
    extracted: fallback.extracted,
  });
}
