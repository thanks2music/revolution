/**
 * 署名付き URL へ画像を上げる、ブラウザ側の部品 (口コミの写真 #163 とプロフィール画像 #171 で共通)
 */
import { REVIEW_PHOTO_TYPES, type ReviewPhotoType } from '@revolution/schemas/review-photo';

/** ブラウザが形式を付けない HEIC (Windows など) は拡張子で見分ける */
export function photoTypeOf(file: { name: string; type: string }): ReviewPhotoType | null {
  if ((REVIEW_PHOTO_TYPES as readonly string[]).includes(file.type))
    return file.type as ReviewPhotoType;
  if (file.type !== '' && file.type !== 'application/octet-stream') return null;
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'heic' || extension === 'heif') return 'image/heic';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return null;
}

/** 署名付き URL へ上げる (進み具合を知るため XMLHttpRequest を使う) */
const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

export function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (ratio: number) => void
): Promise<boolean> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    // 止まった通信で、欄とフォームが作業中のまま固まらないように打ち切る (10MB を遅い回線でも上げられる長さ)
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(file);
  });
}
