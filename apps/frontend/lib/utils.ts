// class 名を結合し、Tailwind の同じ性質の class は後のものを残す (clsx + tailwind-merge の置き換え)。
// `cn` は shadcn/ui 公式のパッケージ (github.com/shadcn-ui/cn)。shadcn の CLI が生成する部品は
// `cn` を直接 import し、このファイルはアプリのコードから使う別名 (components.json の utils)。
export { cn } from 'cn';
