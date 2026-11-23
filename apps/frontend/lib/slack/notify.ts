/** 送信の口は管理アプリと共有するため shared/reviews に置いた (#169)。公開サイトの import はここを通す */
export { notifySlack, type SlackDestination } from '@revolution/reviews/notify-slack';
