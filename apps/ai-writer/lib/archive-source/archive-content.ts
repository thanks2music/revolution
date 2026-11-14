/**
 * Turns an archive article into the inputs the pipeline normally reads from the official site:
 * the page HTML (for extraction and the article text) and the category images (menu / novelty /
 * goods). Used only when the official site is gone.
 *
 * @module lib/archive-source/archive-content
 */
import * as cheerio from 'cheerio';

import type { CategoryImages } from '@/lib/services/category-image-extractor.service';
import { compactHtmlForLlm } from '@/lib/utils/compact-html';
import { mentionsRedrawnIllustration, pageRedrawnWords } from '@/lib/utils/redrawn-illustration';

import type { ArchiveSource } from './config';

type ImageCategory = 'menu' | 'novelty' | 'goods';
const CATEGORIES: readonly ImageCategory[] = ['menu', 'novelty', 'goods'];

export interface ArchivePageContent {
  /** Same shape as `extractContentHtml`: `compacted` goes to the LLM, `raw` keeps the markup */
  contentHtml: { compacted: string; raw: string };
  categoryImages: CategoryImages;
}

/** Removes the archive's own ads, affiliate boxes, embeds and site banners */
export function removeNoise(contentHtml: string, noiseSelectors: readonly string[]): string {
  const $ = cheerio.load(contentHtml, null, false);
  for (const selector of noiseSelectors) $(selector).remove();
  return $.html();
}

/**
 * Collects the article's images by section: an `<h2>` whose text has a category keyword puts the
 * images up to the next `<h2>` into that category. When no `<h2>` has a keyword (older articles
 * title every section after the event), the images after the first `<h2>` go to the event type's
 * default category, if one is set. Otherwise images in other sections are not used.
 */
export function collectSectionImages(
  cleanHtml: string,
  articleUrl: string,
  rules: ArchiveSource['images'],
  eventType: string | null = null,
): Record<ImageCategory, string[]> & { sectionHtml: Record<ImageCategory, string> } {
  const $ = cheerio.load(cleanHtml, null, false);
  const images: Record<ImageCategory, string[]> = { menu: [], novelty: [], goods: [] };
  const sectionHtml: Record<ImageCategory, string> = { menu: '', novelty: '', goods: '' };
  const unsorted: string[] = [];
  let unsortedHtml = '';
  const seen = new Set<string>();
  let afterFirstHeading = false;
  let current: ImageCategory | null = null;

  for (const node of $.root().children().toArray()) {
    const element = $(node);
    if (node.type === 'tag' && node.tagName === 'h2') {
      afterFirstHeading = true;
      current = categoryOfHeading(element.text(), rules.section_keywords);
      continue;
    }
    if (!afterFirstHeading) continue;
    const found = element.is('img') ? [node] : element.find('img').toArray();
    const urls: string[] = [];
    for (const img of found) {
      const url = archiveImageUrl($(img), articleUrl, rules);
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
    if (current) {
      sectionHtml[current] += $.html(element);
      images[current].push(...urls);
    } else {
      unsortedHtml += $.html(element);
      unsorted.push(...urls);
    }
  }

  const fallback = eventType ? rules.default_category_by_event_type[eventType] : undefined;
  if (fallback && CATEGORIES.every((category) => images[category].length === 0)) {
    images[fallback] = unsorted;
    sectionHtml[fallback] = unsortedHtml;
  }
  return { ...images, sectionHtml };
}

export function buildArchivePageContent(
  contentHtml: string,
  articleUrl: string,
  source: ArchiveSource,
  eventType: string | null = null,
): ArchivePageContent {
  const raw = removeNoise(contentHtml, source.noise_selectors);
  const sections = collectSectionImages(raw, articleUrl, source.images, eventType);
  const categoryImages: CategoryImages = {
    menu: sections.menu,
    novelty: sections.novelty,
    goods: sections.goods,
    sources: {},
    all: CATEGORIES.flatMap((category) => sections[category]),
    mentionsRedrawnIllustration: mentionsRedrawnIllustration(raw),
    redrawnPages: CATEGORIES.filter((category) => sections.sectionHtml[category]).map((category) => ({
      kind: category,
      redrawn: pageRedrawnWords(sections.sectionHtml[category], category === 'goods'),
    })),
    // The whole article is the detail-extraction input, so there are no sub-pages to read again
    pages: [],
    venueNoveltyImages: [],
    // The archive's alt texts are almost always empty
    imageAlts: {},
  };
  return { contentHtml: { compacted: compactHtmlForLlm(raw).html, raw }, categoryImages };
}

function categoryOfHeading(text: string, keywords: ArchiveSource['images']['section_keywords']): ImageCategory | null {
  return CATEGORIES.find((category) => keywords[category].some((word) => text.includes(word))) ?? null;
}

/**
 * The image's own URL. Lazy-loaded images keep a placeholder image (not a `data:` URL) in `src` and
 * the real one in `data-src`, so every candidate is checked and the first usable one wins
 */
function archiveImageUrl(
  img: { attr(name: string): string | undefined },
  articleUrl: string,
  rules: ArchiveSource['images'],
): string | null {
  for (const name of ['data-src', 'data-lazy-src', 'src']) {
    const url = usableImageUrl(img.attr(name), articleUrl, rules);
    if (url) return url;
  }
  return null;
}

function usableImageUrl(src: string | undefined, articleUrl: string, rules: ArchiveSource['images']): string | null {
  if (!src?.trim()) return null;
  let url: URL;
  try {
    url = new URL(src.trim(), articleUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(articleUrl).origin) return null;
  if (!rules.path_prefixes.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (rules.exclude_name_contains.some((part) => url.pathname.includes(part))) return null;
  return url.toString();
}
