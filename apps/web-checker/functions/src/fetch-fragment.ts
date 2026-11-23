import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import jschardet from 'jschardet';

import { assertPublicHost } from '@revolution/net/safe-host';

const TIMEOUT_MS = 30_000;
/** ページ 1 枚の上限。お知らせ欄のページは大きくても数 MB */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

// サイトによってはブラウザ以外の UA を拒むため、ブラウザを名乗る (旧 WEB チェッカーと同じ)
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function readBody(response: Response, url: string): Promise<Buffer> {
  if (!response.body) return Buffer.from(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`Response too large (> ${MAX_BYTES} bytes): ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * ページを取得する。リダイレクトは自前で追い、各ホップで内部アドレスでないことを確かめる
 * (`redirect: 'follow'` だと、外部から内部への転送を確かめられない)。
 */
async function fetchPage(rawUrl: string): Promise<Buffer> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'https:' && current.protocol !== 'http:') {
      throw new Error(`Blocked URL scheme "${current.protocol}": ${current.href}`);
    }
    await assertPublicHost(current);

    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without Location (HTTP ${response.status}): ${current.href}`);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${current.href}`);
    return readBody(response, current.href);
  }
  throw new Error(`Too many redirects (> ${MAX_REDIRECTS}): ${rawUrl}`);
}

/** 文字コードを判定して文字列にする (Shift_JIS のサイトがまだある) */
function decode(body: Buffer): string {
  const detected = jschardet.detect(body);
  const encoding = detected.encoding && iconv.encodingExists(detected.encoding) ? detected.encoding : 'utf-8';
  return iconv.decode(body, encoding);
}

/** HTML から、セレクタに一致した最初の要素の中身 (HTML) を返す。一致しなければ `null` */
export function extractFragment(html: string, selector: string): string | null {
  return cheerio.load(html)(selector || 'body').html();
}

export interface FetchFragmentOptions {
  /** 試し直しの待ち時間 (テストで 0 にする) */
  retryDelayMs?: number;
}

/**
 * 監視対象のページを取得し、抜き出す部分の HTML を返す。要素が無ければ `null`。
 * 取得に失敗したら、間を空けて 3 回まで試す。
 */
export async function fetchFragment(
  url: string,
  selector: string,
  options: FetchFragmentOptions = {},
): Promise<string | null> {
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return extractFragment(decode(await fetchPage(url)), selector);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
