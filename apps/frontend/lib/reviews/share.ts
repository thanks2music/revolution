/**
 * X (旧 Twitter) の共有の URL。本文は口コミの中身を含めない (審査の前の文を外に出さない)
 * https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/web-intent
 */
export function buildXShareUrl(input: {
  eventName: string;
  venueName: string;
  siteName: string;
  pageUrl: string;
}): string {
  const text = `${input.eventName} ${input.venueName} の口コミを書きました｜${input.siteName}`;
  const params = new URLSearchParams({ text, url: input.pageUrl });
  return `https://x.com/intent/post?${params.toString()}`;
}
