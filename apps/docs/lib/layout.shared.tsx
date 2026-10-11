import { defineTranslations } from 'fumadocs-core/i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

import { siteName } from '@/lib/metadata';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: siteName,
    },
    githubUrl: 'https://github.com/thanks2music/revolution',
  };
}

// UI の文言を日本語にする (キーは fumadocs-ui の .translations/keys.json)。
// このサイトで使わない部品 (type table・AI チャット・言語切り替え等) のキーは訳さない。
export const translations = defineTranslations()
  .extend(uiTranslations())
  .add({
    'Search(search trigger)': '検索',
    'Search(search dialog)': '検索',
    'Open Search(search trigger)(aria-label)': '検索を開く',
    'Close Search(search dialog)(aria-label)': '検索を閉じる',
    'No results found(search dialog)': '見つかりませんでした',
    'On this page(table of contents)': '目次',
    'No Headings(table of contents)': '見出しがありません',
    'Table of Contents(inline table of contents)': '目次',
    'Previous Page(pagination)': '前のページ',
    'Next Page(pagination)': '次のページ',
    'Open Sidebar(sidebar)(aria-label)': 'サイドバーを開く',
    'Close Sidebar(sidebar)(aria-label)': 'サイドバーを閉じる',
    'Close Sidebar(aria-label)': 'サイドバーを閉じる',
    'Collapse Sidebar(sidebar)(aria-label)': 'サイドバーを折りたたむ',
    'Show Sidebar(sidebar)': 'サイドバーを表示',
    'Hide Sidebar(sidebar)': 'サイドバーを隠す',
    'Toggle Menu(mobile menu)(aria-label)': 'メニューを開閉',
    'Toggle Theme(theme switcher)(aria-label)': 'テーマを切り替え',
    'Light(theme switcher)(aria-label)': 'ライト',
    'Dark(theme switcher)(aria-label)': 'ダーク',
    'System(theme switcher)(aria-label)': 'システム',
    'Copy Text(code block)(aria-label)': 'コードをコピー',
    'Copied Text(code block)(aria-label)': 'コピーしました',
    'Copy Anchor Link(heading anchor)(aria-label)': '見出しへのリンクをコピー',
    'Copied Anchor Link(heading anchor)(aria-label)': 'リンクをコピーしました',
    'Copy Markdown(page actions)': 'Markdown をコピー',
    'Copied Markdown(page actions)': 'コピーしました',
    'Open(page actions)': '開く',
    'View as Markdown(page actions)': 'Markdown で見る',
    'Open in GitHub(page actions)': 'GitHub で開く',
    'Open in ChatGPT(page actions)': 'ChatGPT で開く',
    'Open in Claude(page actions)': 'Claude で開く',
    'Open in Cursor(page actions)': 'Cursor で開く',
    'Open in Scira AI(page actions)': 'Scira AI で開く',
    'Read {url}, I want to ask questions about it.(page actions)':
      '{url} を読んで、内容について質問に答えてください。',
  });
