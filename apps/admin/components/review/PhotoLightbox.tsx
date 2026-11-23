'use client';

import { useEffect } from 'react';

import type { ModerationPhoto } from '@revolution/reviews/moderation';

import type { PhotoMark } from '@/lib/moderation/marks';

import { PhotoMarkControls } from './PhotoMarkControls';
import { PhotoPicture } from './PhotoPicture';

/**
 * 写真の拡大 (Figma F-11 スマホは全画面、F-12 PC はモーダル)。← → キーか ‹ › で前後へ、Esc か × で閉じる。
 * 非公開の印と理由はここでも変えられる (写真の欄と同じ値)
 */
export function PhotoLightbox({
  photos,
  marks,
  index,
  aiJudged,
  disabled,
  onIndexChange,
  onMarkChange,
  onClose,
}: {
  photos: ModerationPhoto[];
  marks: PhotoMark[];
  index: number;
  aiJudged: boolean;
  disabled: boolean;
  onIndexChange: (index: number) => void;
  onMarkChange: (mark: PhotoMark) => void;
  onClose: () => void;
}) {
  const count = photos.length;
  const photo = photos[index];
  const mark = marks[index];

  const step = (delta: number) => onIndexChange((index + delta + count) % count);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onIndexChange((index - 1 + count) % count);
      if (event.key === 'ArrowRight') onIndexChange((index + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onClose, onIndexChange]);

  // 開いている間は後ろの画面をスクロールさせない
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!photo || !mark) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`写真 ${mark.number} / ${count}`}
      className="fixed inset-0 z-40 flex bg-bar lg:items-center lg:justify-center lg:bg-bar/60 lg:p-10"
    >
      <div className="flex w-full flex-col lg:h-[min(90vh,640px)] lg:max-w-5xl lg:flex-row lg:overflow-hidden lg:rounded-2xl">
        <div className="flex min-h-0 flex-1 flex-col bg-bar px-4 py-4">
          <div className="flex items-center justify-between text-white">
            <span className="text-sm font-bold">
              写真 {mark.number} / {count}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="text-2xl lg:hidden"
            >
              ×
            </button>
          </div>
          <div className="relative mt-3 flex min-h-0 flex-1 items-center justify-center">
            {count > 1 && (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="前の写真"
                className="absolute left-0 z-10 px-2 text-2xl text-white"
              >
                ‹
              </button>
            )}
            {photo.view ? (
              <PhotoPicture
                view={photo.view}
                sizes="(min-width: 1024px) 640px, 100vw"
                alt={`写真 ${mark.number}`}
                pictureClassName="flex max-h-full justify-center"
                className={`max-h-[60vh] w-auto rounded-xl object-contain lg:max-h-[480px] ${
                  mark.hide ? 'ring-2 ring-warning' : ''
                }`}
              />
            ) : (
              <div className="flex aspect-[3/4] w-full max-w-md items-center justify-center rounded-xl bg-photo text-sm text-white">
                写真 {mark.number} (この環境では写真を読めません)
              </div>
            )}
            {count > 1 && (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="次の写真"
                className="absolute right-0 z-10 px-2 text-2xl text-white"
              >
                ›
              </button>
            )}
          </div>
          <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
            {marks.map((item, i) => (
              <span
                key={item.id}
                className={`size-1.5 rounded-full ${i === index ? 'bg-white' : 'bg-ink-tertiary'}`}
              />
            ))}
          </div>
        </div>
        <div className="bg-bar-chip/40 px-4 pt-4 pb-6 lg:w-64 lg:shrink-0 lg:bg-surface lg:px-5">
          <div className="hidden items-center justify-between lg:flex">
            <span className="text-sm font-bold text-ink-strong">写真 {mark.number}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="text-xl text-ink-muted"
            >
              ×
            </button>
          </div>
          <div className="text-white lg:mt-4 lg:text-ink-strong">
            <PhotoMarkControls
              mark={mark}
              aiJudged={aiJudged}
              disabled={disabled}
              onChange={onMarkChange}
              size="lg"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
