'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { AVATAR_REJECT_REASON_LABELS } from '@revolution/schemas/profile-avatar';
import {
  MAX_REVIEW_PHOTO_BYTES,
  MAX_REVIEW_PHOTO_MB,
  REVIEW_PHOTO_ACCEPT,
} from '@revolution/schemas/review-photo';
import type { OwnAvatarState } from '@revolution/reviews/avatar/view';

import { attachAvatar, removeAvatar, requestAvatarUpload } from '@/actions/avatar';
import { Avatar } from '@/components/molecules/profile/Avatar';
import { photoTypeOf, putFile } from '@/lib/uploads/signed-put';

const buttonClass =
  'min-h-11 rounded-full border border-(--line-strong) bg-bg-elevated px-4 py-2 font-display text-sm text-ink-strong transition-colors hover:bg-bg-tinted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60';

/**
 * プロフィール画像の欄 (one-more-time #171、Figma #11 と #12-1、状態は #12-1「プロフィール画像の状態」)。
 *
 * 選ぶと受け取り場所へ上げ、取り込んで審査中にする (審査は応答の後に走る)。状態ごとの見せ方:
 * - 未設定: 頭文字 +「画像を選ぶ」
 * - 審査中: 頭文字 +「画像を変える」「画像を外す」+「確認中です」(外すと審査をやめる)
 * - 公開: 画像 +「画像を変える」「画像を外す」
 * - 落ちた: 頭文字 +「別の画像を選ぶ」+ 理由
 * - 外した (BOSS): 頭文字 + 設定できない旨。選ぶボタンは出さない
 */
export function AvatarField({ name, state }: { name: string; state: OwnAvatarState }) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // React が欄に結び付くまで選べないようにする (結び付く前に選んだ画像は、何も起きずに捨てられるため)
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const locked = busy || !ready;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const type = photoTypeOf(file);
    if (!type) return setError('JPEG・PNG・HEIC の画像を選んでください');
    if (file.size > MAX_REVIEW_PHOTO_BYTES)
      return setError(`${MAX_REVIEW_PHOTO_MB}MB を超える画像は使えません`);
    setBusy(true);
    try {
      const request = await requestAvatarUpload({ contentType: type, size: file.size });
      if (!request.ok) return setError(request.error);
      if (!(await putFile(request.url, request.headers, file))) {
        return setError('画像を上げられませんでした。通信を確かめて、もう一度お試しください');
      }
      const attached = await attachAvatar(request.imageId);
      if (!attached.ok) return setError(attached.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setError(null);
    setBusy(true);
    try {
      const result = await removeAvatar();
      if (!result.ok) return setError(result.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const hasImage = state.status === 'pending' || state.status === 'published';
  const pickLabel = hasImage
    ? '画像を変える'
    : state.status === 'rejected'
      ? '別の画像を選ぶ'
      : '画像を選ぶ';

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="avatar-field"
      data-status={state.status ?? 'none'}
    >
      <div className="flex items-center gap-4">
        <Avatar name={name} view={state.view} size={56} />
        {!state.removed && (
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor={inputId}
              className={`${buttonClass} cursor-pointer`}
              aria-disabled={locked}
            >
              {busy ? '送っています…' : pickLabel}
            </label>
            <input
              id={inputId}
              type="file"
              accept={REVIEW_PHOTO_ACCEPT}
              className="sr-only"
              disabled={locked}
              onChange={event => {
                void onFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {hasImage && (
              <button type="button" className={buttonClass} disabled={locked} onClick={onRemove}>
                画像を外す
              </button>
            )}
          </div>
        )}
      </div>
      {state.status === 'pending' && (
        <p role="status" className="text-xs text-ink-muted">
          確認中です。通ると表示されます。それまでは頭文字のアイコンが出ます。
        </p>
      )}
      {state.status === 'rejected' && state.reasonCode && (
        <p
          role="alert"
          className="rounded-[10px] bg-status-cancelled-surface px-3 py-2.5 text-[11px] text-status-cancelled"
        >
          この画像は表示できませんでした: {AVATAR_REJECT_REASON_LABELS[state.reasonCode]}
          。別の画像を選んでください。
        </p>
      )}
      {state.removed ? (
        <p className="rounded-[10px] bg-bg-tinted px-3 py-2.5 text-[11px] text-ink-body">
          この画像は通報を受けて表示をやめました。プロフィール画像は設定できません。
        </p>
      ) : (
        <p className="text-xs text-ink-muted">
          口コミとマイページに表示されます。他人の顔や、権利のある画像は使えません。
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-accent-yellow-deep">
          {error}
        </p>
      )}
    </div>
  );
}
