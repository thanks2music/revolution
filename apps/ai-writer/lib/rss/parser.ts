import Parser from 'rss-parser';

/**
 * RSSフィード項目（標準化）
 */
export interface RssFeedItem {
  /** 記事のGUID（一意識別子） */
  guid: string;
  /** 記事タイトル */
  title: string;
  /** 記事URL */
  link: string;
  /** 記事概要 */
  contentSnippet?: string;
  /** 記事本文（HTML） */
  content?: string;
  /** 公開日時 */
  pubDate?: string;
  /** カテゴリ */
  categories?: string[];
  /** 著者 */
  creator?: string;
}

/**
 * RSSフィードメタデータ
 */
export interface RssFeedMeta {
  /** フィードタイトル */
  title: string;
  /** フィードURL */
  feedUrl: string;
  /** サイトURL */
  link?: string;
  /** フィード説明 */
  description?: string;
}

/**
 * RSSフィード取得結果
 */
export interface RssFeedResult {
  meta: RssFeedMeta;
  items: RssFeedItem[];
}

/**
 * RSSフィードをパース
 *
 * @param feedUrl - RSSフィードのURL
 * @param limit - 取得する記事の最大数（デフォルト: 10）
 * @returns パース済みフィードデータ
 */
export async function parseRssFeed(
  feedUrl: string,
  limit = 10
): Promise<RssFeedResult> {
  const parser = new Parser({
    timeout: 10000, // 10秒タイムアウト
    headers: {
      'User-Agent': 'Revolution AI Writer Bot/1.0',
    },
  });

  try {
    const feed = await parser.parseURL(feedUrl);

    // メタデータ抽出
    const meta: RssFeedMeta = {
      title: feed.title || 'Untitled Feed',
      feedUrl,
      link: feed.link,
      description: feed.description,
    };

    // アイテム正規化（limit適用）
    const items: RssFeedItem[] = feed.items.slice(0, limit).map(item => {
      // GUIDがない場合はリンクをフォールバック
      const guid = item.guid || item.link || '';

      if (!guid) {
        throw new Error(`RSS item missing both guid and link: ${item.title}`);
      }

      return {
        guid,
        title: item.title || 'Untitled Article',
        link: item.link || '',
        contentSnippet: item.contentSnippet,
        content: item.content,
        pubDate: item.pubDate,
        categories: item.categories || [],
        creator: item.creator,
      };
    });

    return { meta, items };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse RSS feed ${feedUrl}: ${errorMessage}`);
  }
}

/**
 * 複数のRSSフィードを一括パース
 *
 * @param feedUrls - RSSフィードのURL配列
 * @param limitPerFeed - フィードごとの取得件数上限
 * @returns パース済みフィードデータの配列
 */
export async function parseMultipleRssFeeds(
  feedUrls: string[],
  limitPerFeed = 10
): Promise<RssFeedResult[]> {
  const results = await Promise.allSettled(
    feedUrls.map(url => parseRssFeed(url, limitPerFeed))
  );

  // 成功したフィードのみ返却、失敗はログ出力
  return results
    .map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`Failed to parse feed ${feedUrls[index]}:`, result.reason);
        return null;
      }
    })
    .filter((result): result is RssFeedResult => result !== null);
}
