#!/bin/bash
set -e

echo "🚀 Cloud Run Docker デプロイ開始..."

# 環境変数チェック
if [[ -z "$DEV_CRD_WP_PROJECT_ID" ]]; then
  echo "❌ 環境変数が設定されていません"
  echo "以下を実行してください:"
  echo "export DEV_CRD_WP_PROJECT_ID='your-project-id'"
  exit 1
fi

# 現在のディレクトリを確認
if [[ ! -f "Dockerfile" ]]; then
  echo "❌ Dockerfileが見つかりません。apps/backend ディレクトリで実行してください。"
  exit 1
fi

# イメージ情報
IMAGE_URL="${DEV_CRD_WP_REGION}-docker.pkg.dev/${DEV_CRD_WP_PROJECT_ID}/${DEV_CRD_WP_ARTIFACT_REPO_NAME}/wordpress-backend:$(date +%Y%m%d-%H%M%S)"

echo "📦 Dockerイメージビルド中..."
docker build --platform linux/amd64 -t $IMAGE_URL .

echo "🚀 Dockerイメージプッシュ中..."
docker push $IMAGE_URL

echo "🚀 Cloud RunへDockerイメージをデプロイ中..."
gcloud run deploy $DEV_CRD_WP_SERVICE_NAME \
  --image=$IMAGE_URL \
  --region=$DEV_CRD_WP_REGION \
  --platform=managed

echo "✅ デプロイ完了!"
echo "🌐 URL: $(gcloud run services describe $DEV_CRD_WP_SERVICE_NAME --region=$DEV_CRD_WP_REGION --format='value(status.url)')"
