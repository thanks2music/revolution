# Frontend: TypeScript ページ Props 型定義の一元管理

> Next.js 16 の **Async Request APIs** 対応に伴い、`apps/frontend/types/page-props.ts` で動的ルートの Props 型を一元管理しています。

## 背景

Next.js 16 から `params` / `searchParams` / `cookies()` / `headers()` / `draftMode()` がすべて Promise 化されました。各ページで個別に型を定義すると、将来の Next.js アップグレードで全ファイルを修正する必要が生じます。これを避けるため、**ページ Props 型を中央集約** しています。

## 中央集約ファイル

`apps/frontend/types/page-props.ts`

## 定義されている型

| 型名 | 用途 | 使用ルート |
|------|------|-----------|
| `PageProps<TParams>` | 汎用ページ Props 型 | すべての動的ルート |
| `ArticlePageParams` | レガシールート用パラメータ | `/articles/[slug]` |
| `ArticlePageParamsNew` | 新ルート用パラメータ | `/[event_type]/[work_slug]/[slug]` |
| `ArticlePageProps` | レガシールート用 Props | `/articles/[slug]/page.tsx`, `opengraph-image.tsx` |
| `ArticlePagePropsNew` | 新ルート用 Props | `/[event_type]/[work_slug]/[slug]/page.tsx`, `opengraph-image.tsx` |

## 使用例

```typescript
import type { ArticlePageProps } from '@/types/page-props';

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params; // Next.js 16: params は Promise
  // ...
}
```

## メリット

- 将来の Next.js アップグレード時の型変更に **一元対応** できる
- 型定義の **一貫性** が保たれる
- 重複コードの削減

## 参照

- [Next.js 16 Upgrade Guide - Async Request APIs](https://nextjs.org/docs/app/building-your-application/upgrading/version-16#async-request-apis)
