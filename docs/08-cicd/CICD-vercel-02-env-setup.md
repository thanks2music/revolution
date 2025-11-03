# Vercel 環境変数セットアップガイド

このドキュメントは、Vercel Dashboard で設定すべき環境変数の一覧です。

## 📋 必須環境変数

以下の環境変数を Vercel Dashboard の **Settings > Environment Variables** で設定してください。

### WordPress 連携設定

#### 1. `NEXT_PUBLIC_WP_ENDPOINT` (必須)
- **説明**: WordPress GraphQL エンドポイント
- **Production 値**: `https://your-production-wordpress.com/graphql`
- **Preview 値**: `https://your-staging-wordpress.com/graphql`
- **Development 値**: `http://localhost:5555/graphql`

#### 2. `NEXT_PUBLIC_WP_URL` (任意)
- **説明**: WordPress サイトURL（OGP画像等で使用）
- **Production 値**: `https://your-production-wordpress.com`
- **Preview 値**: `https://your-staging-wordpress.com`
- **Development 値**: `http://localhost:5555`

### 画像最適化設定

#### 3. `NEXT_PUBLIC_ALLOWED_IMAGE_HOST` (任意)
- **説明**: Next.js Image 最適化で許可するホスト
- **Production 値**: `your-production-wordpress.com`
- **Preview 値**: `your-staging-wordpress.com`
- **Development 値**: `localhost`

#### 4. `NEXT_PUBLIC_GCS_IMAGE_HOST` (任意)
- **説明**: Google Cloud Storage 画像ホスト
- **全環境共通**: `storage.googleapis.com`

#### 5. `NEXT_PUBLIC_GCS_BUCKET` (任意)
- **説明**: GCS バケット名
- **Production 値**: `your-production-bucket-name`
- **Preview 値**: `your-staging-bucket-name`
- **Development 値**: `your-local-bucket-media-name`

### サイトメタデータ

#### 6. `NEXT_PUBLIC_SITE_NAME` (任意)
- **説明**: サイト名
- **デフォルト値**: `Revolution`

#### 7. `NEXT_PUBLIC_SITE_DESCRIPTION` (任意)
- **説明**: サイト説明
- **デフォルト値**: `Next.js + WordPress Headless CMS`

### 開発環境設定

#### 8. `NEXT_PUBLIC_DEBUG` (任意)
- **説明**: デバッグモード
- **Production 値**: `false`
- **Preview 値**: `true`
- **Development 値**: `true`

#### 9. `NEXT_PUBLIC_SWR_REFRESH_INTERVAL` (任意)
- **説明**: SWR リフレッシュ間隔（ミリ秒）
- **Production 値**: `60000`
- **Preview 値**: `10000`
- **Development 値**: `10000`

#### 10. `NEXT_PUBLIC_SWR_DEDUPING_INTERVAL` (任意)
- **説明**: SWR 重複排除間隔（ミリ秒）
- **Production 値**: `60000`
- **Preview 値**: `10000`
- **Development 値**: `10000`

## 🔧 Vercel CLI での設定方法

Vercel CLI を使用して環境変数を設定することも可能です:

```bash
# Production 環境
vercel env add NEXT_PUBLIC_WP_ENDPOINT production

# Preview 環境
vercel env add NEXT_PUBLIC_WP_ENDPOINT preview

# Development 環境
vercel env add NEXT_PUBLIC_WP_ENDPOINT development
```

## 📝 環境変数の引き継ぎ

既存の `.env.local` から Vercel に移行する場合:

```bash
cd apps/frontend

# 現在の環境変数を確認
cat .env.local

# Vercel CLI でプルして現在の設定を確認
vercel env pull .env.vercel

# 必要に応じて Vercel Dashboard で手動設定
```

## ⚠️ 注意事項

1. **`NEXT_PUBLIC_` プレフィックス**
   - このプレフィックスがある環境変数はクライアント側に公開されます
   - 機密情報（APIキー等）には使用しないでください

2. **環境の違い**
   - **Production**: `main` ブランチへのマージ
   - **Preview**: プルリクエスト、その他のブランチ
   - **Development**: ローカル開発環境

3. **キャッシュのクリア**
   - 環境変数を変更した後は、Vercel で再デプロイが必要です
   - ビルドキャッシュもクリアすることを推奨します

## 🔍 現在の設定確認

Vercel Dashboard で以下を確認してください:

1. **Settings > Environment Variables** に移動
2. 上記の環境変数が全て設定されているか確認
3. 各環境（Production/Preview/Development）で正しい値が設定されているか確認

## 📚 参考リンク

- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Next.js Environment Variables](https://nextjs.org/docs/basic-features/environment-variables)
