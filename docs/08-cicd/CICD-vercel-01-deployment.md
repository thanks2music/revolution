# Vercel デプロイメントガイド

このドキュメントは、Revolution Frontend を Vercel にデプロイする際の完全なガイドです。

## 📋 前提条件

- [x] GitHub リポジトリとの連携が完了している
- [x] Vercel プロジェクトが作成されている
- [x] Vercel CLI がインストールされている (`vercel --version`)

## 🚀 初回デプロイ手順

### 1. Vercel Dashboard での設定

#### プロジェクト設定 (Settings > General)

| 設定項目 | 値 |
|---------|-----|
| **Framework Preset** | Next.js |
| **Root Directory** | `apps/frontend` |
| **Node.js Version** | 20.x |

#### Build & Development Settings

| 設定項目 | 推奨値 | 備考 |
|---------|--------|------|
| **Build Command** | (デフォルト) | Next.js が自動検出 (`npm run build`) |
| **Output Directory** | (デフォルト) | Next.js が自動検出 (`.next`) |
| **Install Command** | (デフォルト) | pnpm を自動検出 |
| **Development Command** | (デフォルト) | Next.js が自動検出 |

> **注意**: Vercel は自動的に最適な設定を検出します。特別な理由がない限り、デフォルトのまま使用してください。

### 2. 環境変数の設定

**Settings > Environment Variables** で以下を設定:

必須環境変数のみ:

```bash
NEXT_PUBLIC_WP_ENDPOINT=https://your-wordpress-site.com/graphql
```

その他の環境変数は `VERCEL_ENV_SETUP.md` を参照してください。

### 3. GitHub 連携の確認

**Settings > Git** で以下を確認:

- [x] Production Branch: `main`
- [x] Preview Branches: All branches
- [x] Automatic deployments from Git: Enabled

## 🔄 デプロイフロー

### Production デプロイ

```bash
# main ブランチへマージ
git checkout main
git pull origin main
git merge feature/your-feature
git push origin main

# Vercel が自動的にデプロイを開始
```

### Preview デプロイ

```bash
# フィーチャーブランチをプッシュ
git checkout -b feature/new-feature
git add .
git commit -m "Add new feature"
git push origin feature/new-feature

# Vercel が自動的にプレビューデプロイを作成
```

### 手動デプロイ（CLI）

```bash
cd apps/frontend

# プレビューデプロイ
vercel

# 本番デプロイ
vercel --prod
```

## 🛠️ vercel.json の設定

`apps/frontend/vercel.json` には以下が含まれています:

### スマートビルド設定

```json
{
  "ignoreCommand": "git diff --quiet HEAD^ HEAD ./"
}
```

このコマンドにより、`apps/frontend` ディレクトリに変更がない場合、ビルドがスキップされます。

### リダイレクト設定

WordPress の管理画面へのアクセスをブロック:

```json
{
  "redirects": [
    {
      "source": "/wp-admin",
      "destination": "/",
      "permanent": false
    },
    {
      "source": "/wp-login.php",
      "destination": "/",
      "permanent": false
    }
  ]
}
```

### 追加ヘッダー

SEO 用のヘッダー:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Robots-Tag",
          "value": "index, follow"
        }
      ]
    }
  ]
}
```

### ignoreCommand（スマートビルド）

変更がない場合はビルドをスキップ:

```json
{
  "ignoreCommand": "git diff --quiet HEAD^ HEAD ./"
}
```

## 📊 モノレポ最適化

### Turbo Remote Caching の有効化

Vercel は自動的に Turbo のリモートキャッシュを提供します。

#### 確認方法

```bash
# ビルドログで以下を確認
# ✓ Remote caching enabled
```

#### ローカルでのテスト

```bash
# Vercel にログイン
vercel login

# Turbo のリモートキャッシュを有効化
turbo link

# ビルド実行（キャッシュがヒットするはず）
turbo run build --filter=frontend-nextjs-headless-cms
```

### 環境変数のキャッシュ無効化

`turbo.json` で以下の環境変数を監視:

```json
{
  "globalEnv": [
    "NODE_ENV",
    "NEXT_PUBLIC_*",
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL"
  ]
}
```

これにより、環境変数が変更された場合にキャッシュが無効化されます。

## 🧪 デプロイ前のテスト

### 1. ローカルでのビルドテスト

```bash
cd apps/frontend

# 環境変数の検証
pnpm validate-env

# WordPress 接続テスト付き
pnpm validate-env:test

# ビルドテスト
pnpm build

# 本番サーバーの起動
pnpm start
```

### 2. Vercel CLI でのプレビュー

```bash
cd apps/frontend

# ローカルでプレビュー
vercel dev

# Vercel 環境でビルド
vercel build
```

## 🔍 トラブルシューティング

### ビルドが失敗する場合

#### 1. 環境変数の確認

```bash
# Vercel の環境変数をローカルにプル
cd apps/frontend
vercel env pull .env.vercel

# 環境変数の検証
pnpm validate-env
```

#### 2. ビルドログの確認

Vercel Dashboard > Deployments > [デプロイメント] > Build Logs

よくあるエラー:
- `NEXT_PUBLIC_WP_ENDPOINT is not defined`
  → 環境変数が設定されていません
- `Module not found: Can't resolve '@/...`
  → TypeScript の paths 設定を確認
- `pnpm install failed`
  → `pnpm-lock.yaml` をコミット

#### 3. キャッシュのクリア

```bash
# Vercel CLI でキャッシュをクリア
vercel --force

# または Dashboard で "Redeploy" → "Clear cache and deploy"
```

### デプロイは成功するが、サイトが動作しない場合

#### 1. WordPress への接続確認

```bash
# ブラウザの開発者ツールで確認
# Network タブで GraphQL リクエストを確認
# エラーがある場合、環境変数 NEXT_PUBLIC_WP_ENDPOINT を確認
```

#### 2. セキュリティヘッダーの確認

```bash
# CSP エラーが出る場合
# next.config.mjs の headers() 設定を確認
```

#### 3. 画像が表示されない場合

```bash
# next.config.mjs の remotePatterns を確認
# 環境変数 NEXT_PUBLIC_ALLOWED_IMAGE_HOST を確認
```

## 📈 パフォーマンス最適化

### 1. Edge Functions の活用

Vercel Edge Functions を使用することで、CDN エッジでの動的レンダリングが可能です:

```typescript
// app/layout.tsx または page.tsx
export const runtime = 'edge';
```

### 2. ISR (Incremental Static Regeneration) の活用

```typescript
// app/post/[slug]/page.tsx
export const revalidate = 60; // 60秒ごとに再検証
```

### 3. Image Optimization の確認

Vercel の Image Optimization が有効になっていることを確認:

**Settings > Image Optimization** で確認

## 🔐 セキュリティ

### 1. 環境変数の管理

- 機密情報（APIキー等）は **絶対に** `NEXT_PUBLIC_` プレフィックスを使用しない
- Vercel Dashboard でのみ管理し、コードにコミットしない

### 2. セキュリティヘッダー

`next.config.mjs` で以下のヘッダーが設定されています:

- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy

### 3. WordPress 管理画面の保護

`vercel.json` のリダイレクト設定により、`/wp-admin` と `/wp-login.php` へのアクセスがブロックされています。

## 📚 参考リンク

- [Vercel Documentation](https://vercel.com/docs)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/nextjs)
- [Monorepos on Vercel](https://vercel.com/docs/monorepos)
- [Turbo on Vercel](https://vercel.com/docs/monorepos/turborepo)
- [Environment Variables on Vercel](https://vercel.com/docs/concepts/projects/environment-variables)

## 🎯 チェックリスト

デプロイ前に以下を確認してください:

- [ ] Vercel Dashboard で環境変数が設定されている
- [ ] `vercel.json` が正しく設定されている
- [ ] ローカルでビルドが成功する (`pnpm build`)
- [ ] 環境変数の検証が成功する (`pnpm validate-env:test`)
- [ ] `.vercelignore` が正しく設定されている
- [ ] `turbo.json` が最適化されている
- [ ] GitHub 連携が正しく設定されている
- [ ] Production Branch が `main` に設定されている

すべて✅であれば、デプロイの準備は完了です！
