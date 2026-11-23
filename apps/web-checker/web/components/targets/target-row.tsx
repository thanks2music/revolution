import Link from 'next/link';

import { matchPreset } from '@/lib/target/frequency-presets';
import { formatJst } from '@/lib/format-date';
import { Button, buttonVariants } from '@/components/ui/button';
import type { Target } from '@/types/target';

/**
 * 一覧の 1 件 (表示)。頻度はプリセットに合えばその名前、合わなければ cron をそのまま出す。
 * 権限のある人なら誰でも編集・削除できる (作った人に限らない)。
 */
export function TargetRow({
  target,
  actionsDisabled,
  onEdit,
  onDelete,
}: {
  target: Target;
  /** 他の 1 件を編集している間は、ボタンを押せなくする */
  actionsDisabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const preset = matchPreset(target.cron);

  return (
    <li className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{target.title}</h3>

          {/* 外のサイトなので、参照元を渡さない */}
          <a
            href={target.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-sm break-all text-muted-foreground underline underline-offset-3 hover:text-foreground"
          >
            {target.url}
          </a>

          <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm text-muted-foreground sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-foreground">CSS セレクタ</dt>
            <dd className="break-all">
              <code>{target.selector}</code>
            </dd>

            <dt className="font-medium text-foreground">頻度</dt>
            <dd>
              {preset ? (
                <>
                  {preset.label} <span className="text-xs">({preset.note})</span>
                </>
              ) : (
                <code>{target.cron}</code>
              )}
            </dd>

            <dt className="font-medium text-foreground">最後に見に行った日時</dt>
            <dd>{formatJst(target.checkedAt)}</dd>
          </dl>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            href={`/detail?targetId=${encodeURIComponent(target.id)}`}
            className={buttonVariants({ variant: 'link', size: 'sm' })}
          >
            履歴
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={onEdit}>
              編集
            </Button>
            <Button variant="destructive" size="sm" disabled={actionsDisabled} onClick={onDelete}>
              削除
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
