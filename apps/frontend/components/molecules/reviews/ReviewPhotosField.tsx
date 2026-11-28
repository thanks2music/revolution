'use client';

/**
 * 口コミの写真の欄 (Figma #7 `10:55`、one-more-time #163)。
 *
 * - 選んだその場で、形式 (JPEG・PNG・HEIC)・大きさ (10MB)・枚数 (10 枚) を確かめ、断る理由を出す
 * - 口コミがまだ無ければ、先に下書きを保存してから上げる (`ensureReview`)
 * - 1 枚ずつ、署名付き URL へ直接上げ (進み具合を出す)、上げ終わったら取り込む (サーバーが変換して保管)
 * - 並べ替え (前へ・後へ) と外す。表示は自前で作った大きさを srcset で出し、Vercel の画像変換は通さない
 *
 * Figma に無い物 (外すボタン・並べ替え・断る理由) は、既存の部品と色で仮に作った
 * (デザインの依頼: one-more-time/docs/design/2026-11-kuchikomi-missing-screens/request.md)。
 */

import { useId, useState } from 'react';

import {
  MAX_REVIEW_PHOTO_BYTES,
  MAX_REVIEW_PHOTO_MB,
  MAX_REVIEW_PHOTOS,
  REVIEW_PHOTO_ACCEPT,
  REVIEW_PHOTO_TYPES,
  type ReviewPhotoType,
} from '@revolution/schemas/review-photo';

import type { ReviewRouteParams } from '@/actions/review';
import {
  attachReviewPhoto,
  removeReviewPhoto,
  reorderReviewPhotos,
  requestReviewPhotoUpload,
} from '@/actions/review-photos';
import type { OwnReviewPhoto } from '@revolution/reviews/photos/operations';

import { ReviewPhotoPicture } from './ReviewPhotoPicture';

export type ReviewPhotosFieldProps = {
  route: ReviewRouteParams;
  initialPhotos: OwnReviewPhoto[];
  /** 口コミが無ければ下書きを保存する。保存できなければ false (理由はフォームが出す) */
  ensureReview: () => Promise<boolean>;
  /** 写真を足すと審査し直しになる口コミか (公開中・差し戻し・確認待ち・非公開) */
  rescreensOnAdd: boolean;
  /** 下書きの保存・上げる・外す・並べ替えるの最中か (フォームは、その間の投稿と下書きの保存を止める) */
  onBusyChange?: (busy: boolean) => void;
  /** フォームが投稿・下書きの保存の最中か (その間は写真を足す・外す・並べ替えるを止める) */
  disabled?: boolean;
};

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

/** 選んだ写真を、上げる物と断る理由に分ける */
export function screenSelectedPhotos(
  files: { name: string; type: string; size: number }[],
  room: number
): { accepted: { index: number; type: ReviewPhotoType }[]; errors: string[] } {
  const accepted: { index: number; type: ReviewPhotoType }[] = [];
  const errors: string[] = [];
  let overflow = false;
  files.forEach((file, index) => {
    const type = photoTypeOf(file);
    if (!type) errors.push(`${file.name}: JPEG・PNG・HEIC の写真を選んでください`);
    else if (file.size > MAX_REVIEW_PHOTO_BYTES)
      errors.push(`${file.name}: ${MAX_REVIEW_PHOTO_MB}MB を超えています`);
    else if (accepted.length >= room) overflow = true;
    else accepted.push({ index, type });
  });
  if (overflow)
    errors.push(`写真は ${MAX_REVIEW_PHOTOS} 枚までです。入らなかった写真は付けていません`);
  return { accepted, errors };
}

/** 署名付き URL へ上げる (進み具合を知るため XMLHttpRequest を使う) */
const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

export function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (ratio: number) => void
): Promise<boolean> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
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

export function ReviewPhotosField(props: ReviewPhotosFieldProps) {
  const inputId = useId();
  const [photos, setPhotos] = useState(props.initialPhotos);
  const [upload, setUpload] = useState<{ done: number; total: number; progress: number } | null>(
    null
  );
  const [errors, setErrors] = useState<string[]>([]);
  // 作業中 (写真を選んでから上げ終わるまで = 先の下書きの保存を含む、外す・並べ替えるの保存)
  const [busy, setBusyState] = useState(false);
  const locked = busy || props.disabled === true;
  // フォームへは同じ処理の中で知らせる (effect を待つと、1 回の描画の間フォームのボタンが押せてしまう)
  function setBusy(value: boolean) {
    setBusyState(value);
    props.onBusyChange?.(value);
  }

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const { accepted, errors: refused } = screenSelectedPhotos(
      files,
      MAX_REVIEW_PHOTOS - photos.length
    );
    setErrors(refused);
    if (accepted.length === 0) return;
    setBusy(true);
    try {
      if (await props.ensureReview()) await uploadAll(files, accepted);
    } finally {
      setBusy(false);
    }
  }

  async function uploadAll(files: File[], accepted: { index: number; type: ReviewPhotoType }[]) {
    const failed: string[] = [];
    for (const [done, { index, type }] of accepted.entries()) {
      const file = files[index];
      const sendFailed = `${file.name}: 写真を送れませんでした。通信を確かめて、もう一度お試しください`;
      setUpload({ done, total: accepted.length, progress: 0 });
      try {
        const ticket = await requestReviewPhotoUpload(props.route, {
          contentType: type,
          size: file.size,
        });
        if (!ticket.ok) {
          failed.push(`${file.name}: ${ticket.error}`);
          continue;
        }
        const sent = await putFile(ticket.url, ticket.headers, file, progress =>
          setUpload({ done, total: accepted.length, progress })
        );
        if (!sent) {
          failed.push(sendFailed);
          continue;
        }
        const attached = await attachReviewPhoto(props.route, ticket.photoId);
        if (attached.ok) setPhotos(current => [...current, attached.photo]);
        else failed.push(`${file.name}: ${attached.error}`);
      } catch {
        failed.push(sendFailed);
      }
    }
    setUpload(null);
    setErrors(current => [...current, ...failed]);
  }

  async function change(next: OwnReviewPhoto[], save: () => ReturnType<typeof removeReviewPhoto>) {
    const previous = photos;
    setPhotos(next);
    setErrors([]);
    setBusy(true);
    try {
      const result = await save();
      if (!result.ok) {
        setPhotos(previous);
        setErrors([result.error]);
      }
    } catch {
      setPhotos(previous);
      setErrors(['保存できませんでした。通信を確かめて、もう一度お試しください']);
    } finally {
      setBusy(false);
    }
  }

  function remove(photo: OwnReviewPhoto) {
    void change(
      photos.filter(item => item.id !== photo.id),
      () => removeReviewPhoto(props.route, photo.id)
    );
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...photos];
    const [photo] = next.splice(index, 1);
    next.splice(index + offset, 0, photo);
    void change(next, () =>
      reorderReviewPhotos(
        props.route,
        next.map(item => item.id)
      )
    );
  }

  const room = MAX_REVIEW_PHOTOS - photos.length;
  return (
    <div className="flex flex-col gap-2 pt-4">
      <p className="flex items-center gap-1.5 text-xs font-bold text-ink-strong">
        写真（最大{MAX_REVIEW_PHOTOS}枚）
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">
          任意
        </span>
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="付けた写真" aria-busy={busy}>
        {photos.map((photo, index) => (
          <li key={photo.id} className="relative size-[76px]">
            <ReviewPhotoPicture
              photo={photo}
              size={76}
              alt={`付けた写真 ${index + 1}`}
              className="size-[76px] rounded-xl object-cover"
            />
            <button
              type="button"
              onClick={() => remove(photo)}
              disabled={locked}
              aria-label={`写真 ${index + 1} を外す`}
              className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-ink-strong text-xs text-white shadow disabled:opacity-50"
            >
              ×
            </button>
            {photos.length > 1 && (
              <div className="absolute inset-x-1 bottom-1 flex justify-between">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={locked || index === 0}
                  aria-label={`写真 ${index + 1} を前へ`}
                  className="flex size-6 items-center justify-center rounded-full bg-white/90 text-xs text-ink-strong disabled:invisible"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={locked || index === photos.length - 1}
                  aria-label={`写真 ${index + 1} を後へ`}
                  className="flex size-6 items-center justify-center rounded-full bg-white/90 text-xs text-ink-strong disabled:invisible"
                >
                  →
                </button>
              </div>
            )}
          </li>
        ))}
        {upload && (
          <li className="flex size-[76px] items-end rounded-xl bg-ink-strong/45 p-1" aria-hidden>
            <span className="h-1 w-full overflow-hidden rounded-sm bg-white/40">
              <span
                className="block h-1 bg-accent-yellow"
                style={{ width: `${Math.round(upload.progress * 100)}%` }}
              />
            </span>
          </li>
        )}
        {room > 0 && (
          <li>
            <label
              htmlFor={inputId}
              className={`flex size-[78px] items-center justify-center rounded-xl border border-dashed border-(--line-soft) text-xl text-primary-500 ${
                locked ? 'pointer-events-none opacity-50' : 'cursor-pointer'
              }`}
            >
              <span aria-hidden>＋</span>
              <span className="sr-only">写真を選ぶ</span>
            </label>
            <input
              id={inputId}
              type="file"
              accept={REVIEW_PHOTO_ACCEPT}
              multiple
              disabled={locked}
              className="sr-only"
              onChange={event => {
                const files = event.target.files;
                void onFiles(files);
                event.target.value = '';
              }}
            />
          </li>
        )}
      </ul>
      <p className="text-xs leading-relaxed text-ink-muted" aria-live="polite">
        {upload
          ? `アップロード中… ${upload.done + 1}/${upload.total} 枚`
          : `JPEG・PNG・HEIC、1 枚 ${MAX_REVIEW_PHOTO_MB}MB まで。位置情報などは消してから保存します`}
      </p>
      {props.rescreensOnAdd && (
        <p className="text-xs leading-relaxed text-ink-muted">
          写真を足すと、口コミは審査し直しになります（審査の後に公開されます）
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-xs text-status-cancelled">
          {errors.map((message, index) => (
            <li key={`${index}:${message}`}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
