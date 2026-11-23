import { formatJst } from '@/lib/format-date';
import type { Snapshot } from '@/types/snapshot';

/**
 * 履歴の 1 件。content は外のページの生の HTML なので、`<pre>` に文字として出す
 * (React は `{content}` をエスケープする。dangerouslySetInnerHTML は eslint の react/no-danger で止めている)。
 */
export function SnapshotCard({ snapshot }: { snapshot: Snapshot }) {
  return (
    <li className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{formatJst(snapshot.time)}</h3>
      {/* 1 件が画面を埋めないよう、高さを抑えて中で送る */}
      <pre className="mt-2 max-h-[300px] overflow-y-auto text-xs break-words whitespace-pre-wrap text-muted-foreground">
        {snapshot.content}
      </pre>
    </li>
  );
}
