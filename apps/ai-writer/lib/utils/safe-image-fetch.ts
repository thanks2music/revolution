/**
 * SSRF ガード付きの画像取得
 *
 * 🔴 **なぜこのモジュールが要るか。**
 * OpenAI (`image_url`) / Claude (`source.type: 'url'`) は画像 URL を各社 API へ渡すだけで、
 * 実際の取得は各社サーバーが行う。**Gemini だけは URL 直渡しができず
 * (公開 HTTPS URL を `fileData.fileUri` に渡すと 429 が恒常的に返る)、
 * ai-writer 自身のプロセスが `fetch()` する。**
 *
 * `imageUrls` は**スクレイピングした外部サイト由来**であり、侵害された/悪意あるソースが
 * `http://169.254.169.254/...` のような内部アドレスを返すと、Cloud Run 上の
 * ai-writer がそこへリクエストを送ってしまう (取得結果は Gemini のプロンプトに載る)。
 * よって Gemini 経路を足す本変更と同時にガードを入れる。
 *
 * ⚠️ **残存リスク: DNS rebinding。** 検証時と接続時で名前解決の結果が変わる TOCTOU は
 * アプリ層では塞ぎきれない。完全に塞ぐならネットワーク層 (egress の許可リスト /
 * VPC の firewall) が必要で、それは別レイヤの対処になる。
 *
 * @module lib/utils/safe-image-fetch
 */

import { assertPublicHost } from '@revolution/net/safe-host';

// ホストの判定は全アプリで共有する (shared/net)。既存の import 元を変えずに済むよう、ここからも出す
export { assertPublicHost, isBlockedHost, isBlockedIpv4, isBlockedIpv6, parseIpv6Groups } from '@revolution/net/safe-host';

/** 取得のタイムアウト (ms) */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 1 枚あたりのダウンロード上限 (bytes)
 *
 * 上限なしで `arrayBuffer()` すると、巨大なレスポンスを返すサーバーでメモリが枯渇する。
 * Vision に渡す画像は実測で 6KB〜200KB 程度なので 10MB あれば十分に余裕がある。
 */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** リダイレクトの追跡上限。各ホップで同じ検証をかける */
const MAX_REDIRECTS = 3;

/**
 * レスポンス本文を上限付きで読む
 *
 * 🔴 **`Content-Length` を信用してはいけない。** ヘッダを返さないサーバーも、
 * 過少申告するサーバーもある。`arrayBuffer()` は本文を**全部メモリに載せてから**返すため、
 * 読み終えた後にサイズを判定しても手遅れになる (画像 URL はスクレイピング由来なので、
 * 悪意あるホストが無限長の本文を返せる)。
 *
 * ストリームを chunk 単位で読み、**上限を超えた時点で読むのをやめて body を捨てる**。
 */
async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  url: string
): Promise<Buffer> {
  if (!response.body) {
    // body が無い実装 (テストの簡易 mock 等) では従来どおり読み切ってから判定する
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Image too large (${buffer.length} > ${maxBytes}): ${url}`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      received += value.byteLength;
      if (received > maxBytes) {
        // 残りは読まずに接続ごと捨てる
        await reader.cancel();
        throw new Error(`Image too large (> ${maxBytes} bytes): ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

export interface SafeImageFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** リクエストのヘッダー (ページの取得で User-Agent などを付ける) */
  headers?: Record<string, string>;
}

export interface SafeImageFetchResult {
  /** 取得したバイト列 */
  buffer: Buffer;
  /** レスポンスの `Content-Type` (無ければ `null`) */
  contentType: string | null;
  /** リダイレクト後の最終 URL */
  finalUrl: string;
}

/**
 * 画像を SSRF ガード付きで取得する
 *
 * - スキームは http(s) のみ
 * - ホストが内部アドレス (IP リテラル / DNS 解決結果 / 既知の内部名) なら拒否
 * - **リダイレクトは手動で追跡し、各ホップに同じ検証をかける**
 *   (`redirect: 'follow'` だと外部 → 内部への転送を検証できない)
 * - ダウンロードサイズに上限を設ける
 *
 * @throws {Error} 検証に失敗した / HTTP が失敗した / 上限を超えた場合
 */
export async function fetchImageSafely(
  imageUrl: string,
  options: SafeImageFetchOptions = {}
): Promise<SafeImageFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let current = new URL(imageUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`Blocked image URL scheme "${current.protocol}" for "${current.href}"`);
    }
    await assertPublicHost(current);

    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: options.headers,
    });

    // 3xx は自前で追跡する (各ホップを検証するため)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect without Location header (HTTP ${response.status}): ${current.href}`);
      }
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) for "${imageUrl}"`);
      }
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Image fetch failed (HTTP ${response.status}): ${current.href}`);
    }

    // Content-Length があれば読む前に弾く (早く落とせるなら早く落とす)
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `Image too large (Content-Length ${declared} > ${maxBytes}): ${current.href}`
      );
    }

    return {
      buffer: await readBodyWithLimit(response, maxBytes, current.href),
      contentType: response.headers.get('content-type'),
      finalUrl: current.href,
    };
  }

  // ループは必ず return / throw で抜けるが、型のために置く
  throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) for "${imageUrl}"`);
}

/** ページの本文の上限 (公式サイトの HTML は大きくても数 MB) */
const DEFAULT_PAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * HTML のページを、画像と同じ SSRF ガード付きで取得し、UTF-8 の文字列で返す (2026-10-12)。
 *
 * 下層ページや会場の案内ページの URL は、記事選別 (LLM) の応答やトップページのリンク由来で、
 * 外部の入力にあたる。スキーム・内部アドレス・リダイレクトの各ホップ・本文の大きさを、画像と同じく検証する。
 *
 * @throws {Error} 検証に失敗した / HTTP が失敗した / 上限を超えた場合
 */
export async function fetchPageSafely(
  pageUrl: string,
  options: SafeImageFetchOptions = {}
): Promise<string> {
  const { buffer } = await fetchImageSafely(pageUrl, {
    ...options,
    maxBytes: options.maxBytes ?? DEFAULT_PAGE_MAX_BYTES,
  });
  return buffer.toString('utf-8');
}
