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
      },
      borderColor: {
        DEFAULT: 'var(--line-soft)',
        strong: 'var(--line-strong)',
      },
      fontFamily: {
        body: ['var(--font-body)', 'Noto Sans JP', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'Noto Sans JP', 'sans-serif'],
        numeric: ['var(--font-numeric)', 'var(--font-body)', 'Noto Sans JP', 'sans-serif'],
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
