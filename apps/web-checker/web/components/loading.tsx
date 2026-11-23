import { Spinner } from '@/components/ui/spinner';

/** 読み込み中の表示。読み上げ用に role="status" と文字を持たせる */
export function Loading({ label = '読み込んでいます' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
    >
      <Spinner role="presentation" aria-hidden="true" aria-label={undefined} />
      <span>{label}</span>
    </div>
  );
}
