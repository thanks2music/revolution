import type { AvatarView } from '@revolution/reviews/avatar/view';

/**
 * プロフィール画像 (one-more-time #171)。公開の画像があれば `<picture>` (AVIF / WebP の srcset)、無ければ
 * 表示名の頭文字のアイコン。退会した会員 (名前が無い) は点線の丸。
 *
 * Vercel の画像変換 (`next/image`) は通さない (#156: 画像変換の回数の上限に当たるため)。大きさは自前で作った
 * 64 / 128 / 256 を srcset で出し分ける
 */
export function Avatar({
  name,
  view,
  size,
}: {
  /** 表示名 (頭文字に使う)。退会した会員は null。まだ決めていない (空) 時は、頭文字の無い丸 */
  name: string | null;
  /** 公開の画像。無ければ頭文字 */
  view: AvatarView | null;
  /** 表示の大きさ (px) */
  size: number;
}) {
  const box = { width: size, height: size };
  if (name === null) {
    return (
      <span
        aria-hidden="true"
        style={box}
        className="shrink-0 rounded-full border border-dashed border-(--line-strong) bg-status-scheduled-surface"
      />
    );
  }
  if (view) {
    return (
      <picture className="shrink-0">
        <source type="image/avif" srcSet={view.avifSrcSet} sizes={`${size}px`} />
        <img
          src={view.src}
          srcSet={view.webpSrcSet}
          sizes={`${size}px`}
          width={size}
          height={size}
          alt=""
          className="rounded-full object-cover"
          style={box}
        />
      </picture>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...box, fontSize: Math.round(size * 0.4) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-primary-50 font-display text-primary-700"
    >
      {Array.from(name.trim())[0] ?? ''}
    </span>
  );
}
