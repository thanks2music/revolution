/// <reference path="../heic-decode.d.ts" />
import 'server-only';

import sharp, { type ResizeOptions, type Sharp } from 'sharp';

import { MAX_REVIEW_PHOTO_BYTES, REVIEW_PHOTO_WIDTHS } from '@revolution/schemas/review-photo';

/**
 * 口コミの写真の変換 (one-more-time #163)。受け取った写真を、保管する表示用の大きさに作り直す。
 *
 * - 形式は中身で見分ける (ブラウザが付けた Content-Type は信じない)。JPEG・PNG・HEIC だけ
 * - HEIC は sharp の配布物では読めない (HEVC を含まない) ため、libheif の WebAssembly 版
 *   (heic-decode) で画素に戻してから sharp に渡す。HEIC の回転・反転は libheif が適用する
 * - JPEG・PNG は EXIF の向きに従って回す (`rotate()`)
 * - 出力は WebP と AVIF。sharp は出力にメタデータを付けない (`withMetadata` を呼ばない) ので、
 *   位置情報などの EXIF は残らない。色は sRGB にそろう
 * - まず最大の幅 (1440px) まで縮めた画素を作り、そこから各段を作る (12MP の写真から段ごとに
 *   縮めると、時間とメモリが段の数だけかかる。2026-11-22 の計測で 1.2GB)
 */

/** 読む画素の上限 (50MP)。極端に大きい画像でメモリを使い切らないように */
const MAX_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;
const AVIF_QUALITY = 55;

export type ReviewPhotoFormat = 'jpeg' | 'png' | 'heic';
export type ReviewPhotoVariant = { width: number; format: 'webp' | 'avif'; body: Buffer };

export type ConvertedReviewPhoto = {
  ok: true;
  /** 最大の段の寸法 (向きを直した後)。幅は variantWidths の最後と同じ */
  width: number;
  height: number;
  /** 作った段の幅 (小さい順) */
  variantWidths: number[];
  variants: ReviewPhotoVariant[];
};

export type ConvertReviewPhotoFailure = {
  ok: false;
  /** too_large = 10MB 超 / unsupported = JPEG・PNG・HEIC でない / unreadable = 壊れている・大きすぎる */
  reason: 'too_large' | 'unsupported' | 'unreadable';
};

/** 先頭のバイトで形式を見分ける。分からなければ null */
export function detectReviewPhotoFormat(buffer: Uint8Array): ReviewPhotoFormat | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && PNG.every((byte, i) => buffer[i] === byte)) return 'png';
  // ISO BMFF: 4 バイトの長さ + 'ftyp' + 主のブランド。HEIC と、HEIF の静止画 (mif1) だけ
  if (buffer.length >= 12 && ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12);
    if (['heic', 'heix', 'mif1'].includes(brand)) return 'heic';
  }
  return null;
}

function ascii(buffer: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buffer.subarray(start, end));
}

/**
 * 段の幅を決める。元の写真より大きい段は作らない (拡大しない)。最大の段 (1440) に届かない写真は、
 * 元の幅を一番上の段にする (1000px の写真を 720px までしか出せない、とならないように)
 */
export function variantWidthsFor(width: number): number[] {
  const widths: number[] = REVIEW_PHOTO_WIDTHS.filter(target => target <= width);
  if (
    widths[widths.length - 1] !== width &&
    width < REVIEW_PHOTO_WIDTHS[REVIEW_PHOTO_WIDTHS.length - 1]
  ) {
    widths.push(width);
  }
  return widths;
}

export async function convertReviewPhoto(
  input: Uint8Array
): Promise<ConvertedReviewPhoto | ConvertReviewPhotoFailure> {
  // 最大の段まで縮めた画素 (向きは直してある)。以後の段はここから作る
  const largest = REVIEW_PHOTO_WIDTHS[REVIEW_PHOTO_WIDTHS.length - 1];
  return decodeAndEncode(input, { width: largest, withoutEnlargement: true }, info => {
    const variantWidths = variantWidthsFor(info.width);
    return {
      widths: variantWidths,
      resize: width => ({ width, withoutEnlargement: true }),
      done: variants => ({
        ok: true as const,
        width: info.width,
        height: info.height,
        variantWidths,
        variants,
      }),
    };
  });
}

export type ConvertedSquareImage = {
  ok: true;
  /** 作った段 (正方形)。幅の小さい順に WebP, AVIF */
  variants: ReviewPhotoVariant[];
};

/**
 * 正方形の画像に作り直す (プロフィール画像、one-more-time #171)。形式の見分け・HEIC・向き・メタデータの
 * 扱いは convertReviewPhoto と同じ。真ん中を正方形に切り抜き、`widths` の各段を作る。小さい画像は拡大する
 * (表示は 32〜56px なので、どの段も作っておく)
 */
export async function convertSquareImage(
  input: Uint8Array,
  widths: readonly number[]
): Promise<ConvertedSquareImage | ConvertReviewPhotoFailure> {
  const largest = Math.max(...widths);
  return decodeAndEncode(input, { width: largest, height: largest, fit: 'cover' }, () => ({
    widths: [...widths].sort((a, b) => a - b),
    resize: width => ({ width, height: width }),
    done: variants => ({ ok: true as const, variants }),
  }));
}

/**
 * 形式を見分けて読み込み、`first` まで縮めた画素から、各段を WebP と AVIF で書き出す (2 つの変換の共通部分)
 */
async function decodeAndEncode<T>(
  input: Uint8Array,
  first: ResizeOptions,
  plan: (info: { width: number; height: number }) => {
    widths: number[];
    resize: (width: number) => ResizeOptions;
    done: (variants: ReviewPhotoVariant[]) => T;
  }
): Promise<T | ConvertReviewPhotoFailure> {
  if (input.length > MAX_REVIEW_PHOTO_BYTES) return { ok: false, reason: 'too_large' };
  const format = detectReviewPhotoFormat(input);
  if (!format) return { ok: false, reason: 'unsupported' };

  try {
    const source = format === 'heic' ? await fromHeic(input) : fromJpegOrPng(input);
    if (!source) return { ok: false, reason: 'unreadable' };

    const { data, info } = await source.resize(first).raw().toBuffer({ resolveWithObject: true });
    const raw = { width: info.width, height: info.height, channels: info.channels };
    const { widths, resize, done } = plan(info);

    const variants: ReviewPhotoVariant[] = [];
    // 段は順に作る (同時に作るとメモリが段の数だけ要る。関数は 2GB)
    for (const width of widths) {
      const resized = () => sharp(data, { raw }).resize(resize(width));
      variants.push({
        width,
        format: 'webp',
        body: await resized().webp({ quality: WEBP_QUALITY }).toBuffer(),
      });
      variants.push({
        width,
        format: 'avif',
        body: await resized().avif({ quality: AVIF_QUALITY }).toBuffer(),
      });
    }
    return done(variants);
  } catch {
    // 壊れた写真・画素の上限を超えた写真。理由は利用者に「読めなかった」とだけ返す
    return { ok: false, reason: 'unreadable' };
  }
}

function fromJpegOrPng(input: Uint8Array): Sharp {
  // rotate() は EXIF の向きに従って回し、向きの印を外す
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
}

async function fromHeic(input: Uint8Array): Promise<Sharp | null> {
  const { default: decode } = await import('heic-decode');
  const images = await decode.all({ buffer: input });
  try {
    const first = images[0];
    if (!first || first.width * first.height > MAX_INPUT_PIXELS) return null;
    const { width, height, data } = await first.decode();
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
    });
  } finally {
    images.dispose();
  }
}
