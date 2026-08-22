import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--bg-primary)',
          elevated: 'var(--bg-elevated)',
          tinted: 'var(--bg-tinted)',
        },
        ink: {
          strong: 'var(--ink-strong)',
          body: 'var(--ink-body)',
          muted: 'var(--ink-muted)',
        },
        primary: {
          50: 'var(--primary-50)',
          100: 'var(--primary-100)',
          300: 'var(--primary-300)',
          500: 'var(--primary-500)',
          600: 'var(--primary-600)',
          700: 'var(--primary-700)',
          // 白文字を載せる塗りボタン専用の濃色 (WCAG AA、白とのコントラスト 5.46:1 / hover 6.84:1)。
          strong: 'var(--primary-strong)',
          'strong-hover': 'var(--primary-strong-hover)',
        },
        accent: {
          yellow: 'var(--accent-yellow)',
          'yellow-deep': 'var(--accent-yellow-deep)',
        },
        // 開催状態バッジ (Claude Design v6)。AA 是正の経緯は globals.css を参照。
        // `cancelled` は塗りではなく**文字色**なので注意 (地は cancelled-surface)。
        status: {
          ongoing: 'var(--status-ongoing)',
          'scheduled-surface': 'var(--status-scheduled-surface)',
          'scheduled-ink': 'var(--status-scheduled-ink)',
          'ended-surface': 'var(--status-ended-surface)',
          'ended-ink': 'var(--status-ended-ink)',
          'cancelled-surface': 'var(--status-cancelled-surface)',
          cancelled: 'var(--status-cancelled)',
          'unscheduled-line': 'var(--status-unscheduled-line)',
        },
        // 残日数。--days-* は淡色のため前景は常に ink-strong。
        days: {
          soon: 'var(--days-soon)',
          urgent: 'var(--days-urgent)',
        },
        // 記事カード (クリーム地 + 明朝) と終了開催のアーカイブ地。
        article: {
          DEFAULT: 'var(--bg-article)',
          line: 'var(--line-article)',
          ink: 'var(--ink-article)',
          muted: 'var(--ink-article-muted)',
        },
        archive: {
          DEFAULT: 'var(--bg-archive)',
          line: 'var(--line-archive)',
          ink: 'var(--ink-archive)',
        },
        // 企画の主分類 (イベントタイプ) タグ。白文字を載せる。
        tag: {
          type: 'var(--tag-type-surface)',
        },
      },
      borderColor: {
        DEFAULT: 'var(--line-soft)',
        strong: 'var(--line-strong)',
      },
      fontFamily: {
        body: ['var(--font-body)', 'Noto Sans JP', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'Noto Sans JP', 'sans-serif'],
        numeric: ['var(--font-numeric)', 'var(--font-body)', 'Noto Sans JP', 'sans-serif'],
        // 記事カードの見出し (Claude Design v6 #17/#18)。読み物としての活字トーン。
        serif: ['var(--font-serif)', 'Hiragino Mincho ProN', 'YuMincho', 'serif'],
      },
      width: {
        main: 'var(--container-main)',
      },
      spacing: {
        'section-pc': 'var(--space-section-pc)',
        'section-sp': 'var(--space-section-sp)',
      },
      keyframes: {
        // 追加表示された記事カード用のソフトなフェード+わずかな上方向の動き。
        // 過剰なモーションを避けるため translateY は 8px に抑制。
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.45s ease-out both',
      },
    },
  },
  plugins: [],
};
export default config;
