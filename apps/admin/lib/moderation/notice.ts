/** 操作の後の知らせ (Figma 13・F-9)。一覧のページ (サーバー) が種類を確かめ、Notice (クライアント) が出す */
const MESSAGES = {
  published: (title: string) => `${title} を公開しました`,
  rejected: (title: string) => `${title} を差し戻しました`,
  requeued: (title: string) => `${title} を AI にかけ直しました。結果は数分で出ます`,
} as const;

export type NoticeKind = keyof typeof MESSAGES;

export function isNoticeKind(value: string | undefined): value is NoticeKind {
  return value !== undefined && Object.hasOwn(MESSAGES, value);
}

export function noticeMessage(kind: NoticeKind, title: string): string {
  return MESSAGES[kind](title);
}
