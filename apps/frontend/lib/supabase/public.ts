/**
 * Supabase 公開データ用クライアント (cookie を触らない / SSG 可能)
 *
 * ## なぜ `lib/supabase/server.ts` を使わないのか
 *
 * `server.ts` の `createClient()` は `cookies()` を読む。Next.js App Router では
 * `cookies()` を読んだ時点でそのルートは **dynamic rendering へ落ちる**
 * (公式: Dynamic APIs opt a route into dynamic rendering)。
 *
 * S2 は定義上 **「SSG で成立する塊」**（`strategy.md` §5-2「DB 書き込み不要 =
 * 会員機能を待たず出せる」）なので、開催 / 企画 / 作品 / 会場ページで
 * `server.ts` を使うと **その前提が黙って崩れる**。ビルドは成功し、ページも
 * 表示されるため、気づく手段が実質ない類の劣化になる。
 *
 * 本クライアントは cookie もセッションも持たない anon 接続で、
 * `generateStaticParams` からもビルド時に呼べる。
 *
 * ## 見えるデータの範囲
 *
 * anon ロールで接続するため RLS がそのまま効く。`occurrence_view` は
 * `security_invoker = on` なので **`verified = true` の開催しか返らない**
 * (`shared/schemas/occurrence.ts` の `OccurrenceViewSchema` docstring 参照)。
 * 未承認の開催を読みたい審査キュー用途では本クライアントを使わないこと。
 *
 * ## 使ってはいけない場面
 *
 * - ログインユーザー固有のデータ (マイページ / お気に入り) → `server.ts`
 * - service_role が必要な書き込み・審査 → `admin.ts`
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * 公開データ用の接続情報が揃っているか。
 *
 * ## なぜ必要か (2026-08-14、PR #302 の CI 失敗で判明)
 *
 * CI の `Build Apps` は **`SKIP_ENV_VALIDATION=true` で Supabase の変数を渡さない**
 * (`.github/workflows/ci.yml`)。ジョブの目的は「コンパイルが通ること」であって
 * DB への到達性ではないため、これは意図的な設計。
 *
 * 一方 `generateStaticParams` はビルド時に走る。**開催詳細ページは「ビルド時に
 * DB を叩く最初のページ」**で、既存の DB 参照ページ (mypage / onboarding / login)
 * はすべて dynamic なのでビルド時には走らず、この問題を踏んでいなかった。
 *
 * よって呼び出し側は「資格情報が無い」(= 資格情報を持たないビルド) と
 * 「資格情報はあるがクエリが失敗した」(= 実際の障害) を区別する。
 * 後者は従来どおり throw させる。
 *
 * ⚠️ `env` は `SKIP_ENV_VALIDATION=true` のとき検証を飛ばして素通しするため、
 *    ここでは値が undefined / 空文字になり得る前提で判定する。
 */
export function hasPublicSupabaseCredentials(): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function createPublicClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        // ビルド時 / サーバ実行時にセッションを持たない。永続化やトークン更新を
        // 試みると Node 環境で無意味な処理が走るため明示的に切る。
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
