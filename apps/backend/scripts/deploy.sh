#!/bin/bash
set -e

# スクリプトのディレクトリを取得
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BACKEND_DIR="$( cd "$SCRIPT_DIR/.." &> /dev/null && pwd )"

# プロダクション環境の環境変数
ENV_FILE="$BACKEND_DIR/.env.production"
if [ -f "$ENV_FILE" ]; then
  echo "📄 環境変数ファイル読み込み: $ENV_FILE"


  # 行頭が空白 + #（コメント行）で始まる行を除外し、かつ空行も除外する
  while IFS= read -r line; do
    if [[ ! "$line" =~ ^[[:space:]]*# ]] && [[ -n "$line" ]]; then
      export "$line"
    fi
  done < "$ENV_FILE"

else
  echo "❌ 環境変数ファイルが見つかりません: $ENV_FILE"
  exit 1
fi

echo ""
echo "🚀 Revolution Backend デプロイ開始..."

# 環境変数チェック

if [[ -z "$PROJECT_ID" ]]; then
  echo "❌ 環境変数が設定されていません"
  exit 1
fi

# タグ生成
TAG=$(date +%Y%m%d-%H%M%S)
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO_NAME}/wordpress:${TAG}"

echo "📦 Docker イメージビルド中..."
docker build --platform linux/amd64 -t $IMAGE_URL .

echo "📤 イメージプッシュ中..."
docker push $IMAGE_URL

echo "🚀 Cloud Run デプロイ中..."
gcloud run deploy $SERVICE_NAME \
  --image=$IMAGE_URL \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=600 \
  --min-instances=0 \
  --max-instances=10 \
  --execution-environment=gen2 \
  --cpu-throttling \
  --service-account=revo-wordpress-app@${PROJECT_ID}.iam.gserviceaccount.com \
  --labels=app=revolution,env=prod,component=wordpress,tier=web \
  --set-env-vars="BUCKET_NAME=${BUCKET_NAME},HOST=0.0.0.0" \
  --set-secrets="DB_NAME=revo-wp-db-name:latest,DB_USER=revo-wp-db-user:latest,DB_PASSWORD=revo-wp-db-password:latest,DB_CONNECTION_NAME=revo-wp-db-connection-name:latest,WP_AUTH_KEY=revo-wp-auth-key:latest,WP_SECURE_AUTH_KEY=revo-wp-secure-auth-key:latest,WP_LOGGED_IN_KEY=revo-wp-logged-in-key:latest,WP_NONCE_KEY=revo-wp-nonce-key:latest,WP_AUTH_SALT=revo-wp-auth-salt:latest,WP_SECURE_AUTH_SALT=revo-wp-secure-auth-salt:latest,WP_LOGGED_IN_SALT=revo-wp-logged-in-salt:latest,WP_NONCE_SALT=revo-wp-nonce-salt:latest" \
  --add-cloudsql-instances=${PROJECT_ID}:${REGION}:${DB_INSTANCE_NAME}

echo "✅ デプロイ完了!"

# サービスURL取得
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
echo "🌐 WordPress URL: $SERVICE_URL"
echo "📊 GraphQL Endpoint: $SERVICE_URL/graphql"
