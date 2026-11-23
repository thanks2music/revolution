import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Firebase Hosting に静的に置く。ログインした人がブラウザから Firestore を読み書きするだけなので、
  // サーバーは要らない。middleware も API Route も無いので、データを守るのは Firestore の rules だけ
  // (画面のログインの確認は使い勝手のためのもの)
  output: 'export',

  // 既定値と同じだが、意図して false にしている。true だと out/detail/index.html になり、
  // Hosting の rewrites (`/detail` → `/detail.html`、apps/web-checker/firebase.json) と合わなくなる
  trailingSlash: false,

  // output: 'export' では next/image の既定のローダーが使えない (今は next/image を使っていない)
  images: { unoptimized: true },

  reactStrictMode: true,
};

export default nextConfig;
