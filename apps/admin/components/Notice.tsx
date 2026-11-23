'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { noticeMessage, type NoticeKind } from '@/lib/moderation/notice';

/**
 * 操作の後の知らせ (Figma 13 の「AI にかけ直した後」と F-9)。数秒で消し、URL からも外す
 * (読み直した時にもう一度出ないように)
 */
export function Notice({ kind, title }: { kind: NoticeKind; title: string }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => router.replace('/'), 5000);
    return () => clearTimeout(timer);
  }, [router]);
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-6 z-30 mx-auto flex max-w-md items-center gap-2 rounded-xl bg-bar px-4 py-3 text-sm font-bold text-white shadow-lg"
    >
      <span aria-hidden>✓</span>
      {noticeMessage(kind, title)}
    </div>
  );
}
