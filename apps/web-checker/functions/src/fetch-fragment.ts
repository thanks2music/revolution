import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';

import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import { Agent } from 'undici';

import { BlockedHostError, assertPublicHost, isBlockedIpv4, isBlockedIpv6 } from '@revolution/net/safe-host';

import { isHttpUrl } from './http-url';

const TIMEOUT_MS = 30_000;
/** ページ 1 枚の上限。お知らせ欄のページは大きくても数 MB */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

// サイトによってはブラウザ以外の UA を拒むため、ブラウザを名乗る (旧 WEB チェッカーと同じ)
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * 接続する時の名前解決。解決したアドレスが 1 つでも内部を指していたら、接続しない。
 *
 * `assertPublicHost` は取得の前に名前を解決して確かめるが、接続する時にもう一度解決されるので、
 * その間に DNS の答えを内部のアドレスへ変えられると (DNS rebinding) すり抜ける。接続に使う解決の中で
 * 確かめれば、確かめたアドレスと接続するアドレスが同じになる。
 */
export function guardedLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const blocked = addresses.find(({ address, family }) =>
      family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address),
    );
    if (blocked) {
      return callback(
        new BlockedHostError(`Blocked host (resolves to internal address): ${hostname} → ${blocked.address}`),
        [],
      );
    }
    if (options.all) return callback(null, addresses);
    const [first] = addresses;
    if (!first) return callback(new Error(`No address for ${hostname}`), []);
    return callback(null, first.address, first.family);
  });
}

// Node の fetch は undici で動くので、接続の名前解決を差し替えた dispatcher を渡す (版は Node の同梱にそろえる)
export const guardedDispatcher = new Agent({ connect: { lookup: guardedLookup } });

/**
 * 試し直しても直らない失敗 (内部アドレス・http(s) 以外・大きすぎる・4xx)。これは 1 回で諦める。
 * 試し直すのは、通信のエラー・時間切れ・5xx・429 だけ
 */
class PermanentFetchError extends Error {
  override name = 'PermanentFetchError';
}

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
        throw new PermanentFetchError(`Response too large (> ${MAX_BYTES} bytes): ${url}`);
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
interface FetchedPage {
  body: Buffer;
  /** レスポンスの Content-Type (文字コードの判定に使う) */
  contentType: string | null;
  /** リダイレクトを追った後の URL */
  finalUrl: string;
}

async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isHttpUrl(current)) {
      throw new PermanentFetchError(`Blocked URL scheme "${current.protocol}": ${current.href}`);
    }
    // 内部アドレスなら BlockedHostError (試し直さない)。名前を解決できない時は DNS の一時的な失敗かもしれないので試し直す
    await assertPublicHost(current);

    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
      // @ts-expect-error -- Node の fetch は undici の dispatcher を受け付けるが、DOM の RequestInit の型には無い
      dispatcher: guardedDispatcher,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without Location (HTTP ${response.status}): ${current.href}`);
      try {
        current = new URL(location, current);
      } catch {
        throw new PermanentFetchError(`Invalid redirect Location: ${current.href}`);
      }
      continue;
    }
    if (!response.ok) {
      const message = `HTTP ${response.status}: ${current.href}`;
      const retryable = response.status >= 500 || response.status === 429;
      throw retryable ? new Error(message) : new PermanentFetchError(message);
    }
    return {
      body: await readBody(response, current.href),
      contentType: response.headers.get('content-type'),
      finalUrl: current.href,
    };
  }
  throw new PermanentFetchError(`Too many redirects (> ${MAX_REDIRECTS}): ${rawUrl}`);
}

/** Content-Type か `<meta>` に書かれた文字コード (書かれていなければ null) */
export function declaredCharset(contentType: string | null, body: Buffer): string | null {
  const fromHeader = contentType?.match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1];
  if (fromHeader) return fromHeader;
  // <meta charset="..."> と <meta http-equiv="Content-Type" content="...; charset=..."> は、先頭の方にある
  const head = body.subarray(0, 4096).toString('latin1');
  return head.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1] ?? null;
}

/**
 * 文字列にする。文字コードは Content-Type → `<meta>` → 推測 (jschardet) の順に決める。
 * 推測だけに頼ると、ほとんど ASCII の UTF-8 のページを別の文字コードと見誤り、取得のたびに中身が
 * 変わって見える (更新の誤検知) ことがあるため。Shift_JIS のサイトはまだある
 */
function decode(page: FetchedPage): string {
  const declared = declaredCharset(page.contentType, page.body);
  if (declared && iconv.encodingExists(declared)) return iconv.decode(page.body, declared);
  // 推測は本文の全体を走査するので、宣言が無い (か読めない) 時だけ行う
  const guessed = jschardet.detect(page.body).encoding;
  return iconv.decode(page.body, guessed && iconv.encodingExists(guessed) ? guessed : 'utf-8');
}

export interface FetchedFragment {
  /** セレクタに一致した最初の要素の中身 (HTML)。一致しなければ `null` */
  html: string | null;
  /**
   * 抜き出した HTML の相対リンクを直す基準の URL。ページの `<base href>` があればそれ、無ければ
   * リダイレクトを追った後の URL (監視対象の URL とは違うことがある)
   */
  baseUrl: string;
}

/** HTML から抜き出す。セレクタの書き方が壊れていれば、cheerio の例外がそのまま出る */
export function extractFragment(html: string, selector: string, pageUrl: string): FetchedFragment {
  const $ = cheerio.load(html);
  let baseUrl = pageUrl;
  const baseHref = $('base[href]').first().attr('href');
  if (baseHref) {
    try {
      const resolved = new URL(baseHref, pageUrl);
      if (isHttpUrl(resolved)) baseUrl = resolved.href;
    } catch {
      // 読めない <base> は無視する
    }
  }
  return { html: $(selector || 'body').html(), baseUrl };
}

interface FetchFragmentOptions {
  /** 試し直しの待ち時間 (テストで 0 にする) */
  retryDelayMs?: number;
}

/**
 * 監視対象のページを取得し、抜き出す部分の HTML と、相対リンクの基準の URL を返す。
 * 通信のエラー・時間切れ・5xx・429 なら、間を空けて 3 回まで試す。抜き出しは取得の後に 1 回だけ行う
 * (セレクタの誤りは何度試しても同じなので、取得し直さない)。
 */
export async function fetchFragment(
  url: string,
  selector: string,
  options: FetchFragmentOptions = {},
): Promise<FetchedFragment> {
  const page = await fetchPageWithRetry(url, options.retryDelayMs ?? RETRY_DELAY_MS);
  return extractFragment(decode(page), selector, page.finalUrl);
}

async function fetchPageWithRetry(url: string, retryDelayMs: number): Promise<FetchedPage> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchPage(url);
    } catch (error) {
      lastError = error;
      if (error instanceof PermanentFetchError || error instanceof BlockedHostError) break;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
