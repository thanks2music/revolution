import { TargetList } from '@/components/targets/target-list';

/** 監視対象の一覧・作成・編集・削除 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <TargetList />
    </main>
  );
}
