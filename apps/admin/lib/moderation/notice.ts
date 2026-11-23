/** 操作の後の知らせ (Figma 13・F-9)。一覧のページ (サーバー) が種類を確かめ、Notice (クライアント) が出す */
const MESSAGES = {
  published: (title: string) => `${title} を公開しました`,
  rejected: (title: string) => `${title} を差し戻しました`,
  requeued: (title: string) => `${title} を AI にかけ直しました。結果は数分で出ます`,
  // 通報の処理 (#168)
  hidden: (title: string) => `${title} の口コミを非公開にしました`,
  kept: (title: string) => `${title} の口コミを直して、公開のままにしました`,
  dismissed: (title: string) => `${title} の通報を問題なしで閉じました`,
} as const;

export type NoticeKind = keyof typeof MESSAGES;

export function isNoticeKind(value: string | undefined): value is NoticeKind {
  return value !== undefined && Object.hasOwn(MESSAGES, value);
}

export function noticeMessage(kind: NoticeKind, title: string): string {
  return MESSAGES[kind](title);
}
