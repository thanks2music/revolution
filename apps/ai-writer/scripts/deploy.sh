#!/bin/bash
set -e

# ==============================================================================
# Revolution AI Writer (Discovery) - Cloud Run デプロイスクリプト
# ==============================================================================

# 色付きログ用の定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

# ==============================================================================
# 環境変数設定
# ==============================================================================

# .env.deploy から環境変数を読み込む（存在する場合）
if [ -f ".env.deploy" ]; then
  log_info "📂 .env.deploy から環境変数を読み込んでいます..."
  export $(grep -v '^#' .env.deploy | xargs)
fi

# デフォルト値を設定（.env.deployで上書き可能）
export PROJECT_ID="${GCP_PROJECT_ID:-t4v-revo-prd}"
export REGION="${GCP_REGION:-asia-northeast1}"
export SERVICE_NAME="${SERVICE_NAME:-revo-ai-writer}"
export ARTIFACT_REPO_NAME="${ARTIFACT_REPO_NAME:-revo-wordpress-repo}"
export SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-revo-wordpress-app}"

log_info "🚀 Revolution AI Writer (Discovery) デプロイ開始..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Project ID: ${PROJECT_ID}"
log_info "Region: ${REGION}"
log_info "Service Name: ${SERVICE_NAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ==============================================================================
# 前提条件チェック
# ==============================================================================

log_info "🔍 前提条件をチェック中..."

# gcloud がインストールされているか
if ! command -v gcloud &> /dev/null; then
  log_error "gcloud CLI がインストールされていません"
  exit 1
fi

# docker がインストールされているか
if ! command -v docker &> /dev/null; then
  log_error "Docker がインストールされていません"
  exit 1
fi

# 現在のプロジェクトを確認
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
  log_warning "現在のプロジェクトは ${CURRENT_PROJECT} です"
  log_info "プロジェクトを ${PROJECT_ID} に切り替えています..."
  gcloud config set project $PROJECT_ID
fi

log_success "前提条件チェック完了"
echo ""

# ==============================================================================
# Docker イメージのビルドとプッシュ
# ==============================================================================

# タグ生成（タイムスタンプベース）
TAG=$(date +%Y%m%d-%H%M%S)
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO_NAME}/ai-writer:${TAG}"
IMAGE_URL_LATEST="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO_NAME}/ai-writer:latest"

log_info "📦 Docker イメージをビルド中..."
log_info "Image URL: ${IMAGE_URL}"

# モノレポルートに移動してビルド
cd ../..

# Docker ビルド（Apple Silicon対応でlinux/amd64を指定）
# モノレポ対応: コンテキストはルート、Dockerfileはapps/ai-writer/
# --no-cache: Dockerキャッシュが古いコードを保持している問題の解決
# Firebase環境変数をビルド時に渡す（Secret Managerから取得）
# 注意: ALLOWED_EMAILS は実行時にSecret Managerから渡すため、ここでは含めない

log_info "🔐 Secret Manager から Firebase 設定を取得中..."

# Secret Managerから環境変数を取得
FIREBASE_API_KEY=$(gcloud secrets versions access latest --secret="revo-firebase-api-key" --project=$PROJECT_ID)
FIREBASE_AUTH_DOMAIN=$(gcloud secrets versions access latest --secret="revo-firebase-auth-domain" --project=$PROJECT_ID)
FIREBASE_PROJECT_ID=$(gcloud secrets versions access latest --secret="revo-firebase-project-id" --project=$PROJECT_ID)
FIREBASE_STORAGE_BUCKET=$(gcloud secrets versions access latest --secret="revo-firebase-storage-bucket" --project=$PROJECT_ID)
FIREBASE_MESSAGING_SENDER_ID=$(gcloud secrets versions access latest --secret="revo-firebase-messaging-sender-id" --project=$PROJECT_ID)
FIREBASE_APP_ID=$(gcloud secrets versions access latest --secret="revo-firebase-app-id" --project=$PROJECT_ID)
WP_ENDPOINT=$(gcloud secrets versions access latest --secret="revo-wp-graphql-endpoint" --project=$PROJECT_ID)

log_success "Secret Manager からの取得完了"

docker build \
  --no-cache \
  --platform linux/amd64 \
  -f apps/ai-writer/Dockerfile \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="${FIREBASE_API_KEY}" \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN}" \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID}" \
  --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET}" \
  --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="${FIREBASE_MESSAGING_SENDER_ID}" \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID="${FIREBASE_APP_ID}" \
  --build-arg NEXT_PUBLIC_WP_ENDPOINT="${WP_ENDPOINT}" \
  -t $IMAGE_URL \
  -t $IMAGE_URL_LATEST \
  .

# 元のディレクトリに戻る
cd apps/ai-writer

if [ $? -ne 0 ]; then
  log_error "Docker ビルドに失敗しました"
  exit 1
fi

log_success "Docker イメージのビルド完了"
echo ""

log_info "📤 Docker イメージをプッシュ中..."

# Docker 認証設定（初回のみ必要だが、念のため実行）
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

# イメージプッシュ
docker push $IMAGE_URL
docker push $IMAGE_URL_LATEST

if [ $? -ne 0 ]; then
  log_error "Docker イメージのプッシュに失敗しました"
  exit 1
fi

log_success "Docker イメージのプッシュ完了"
echo ""

# ==============================================================================
# Cloud Run デプロイ
# ==============================================================================

log_info "🚀 Cloud Run にデプロイ中..."

gcloud run deploy $SERVICE_NAME \
  --image=$IMAGE_URL \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=600 \
  --min-instances=0 \
  --max-instances=5 \
  --execution-environment=gen2 \
  --cpu-throttling \
  --service-account=${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com \
  --labels=app=revolution,env=prod,component=ai-writer,tier=web \
  --set-env-vars="NODE_ENV=production,NEXT_TELEMETRY_DISABLED=1" \
  --set-secrets="GOOGLE_APPLICATION_CREDENTIALS_JSON=revo-firebase-service-account:latest,NEXT_PUBLIC_WP_ENDPOINT=revo-wp-graphql-endpoint:latest,WORDPRESS_AUTH_TOKEN=revo-wp-auth-token:latest,ANTHROPIC_API_KEY=revo-anthropic-api-key:latest,NEXT_PUBLIC_FIREBASE_API_KEY=revo-firebase-api-key:latest,NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=revo-firebase-auth-domain:latest,NEXT_PUBLIC_FIREBASE_PROJECT_ID=revo-firebase-project-id:latest,NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=revo-firebase-storage-bucket:latest,NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=revo-firebase-messaging-sender-id:latest,NEXT_PUBLIC_FIREBASE_APP_ID=revo-firebase-app-id:latest,ALLOWED_EMAILS=revo-allowed-emails:latest"

if [ $? -ne 0 ]; then
  log_error "Cloud Run デプロイに失敗しました"
  exit 1
fi

log_success "Cloud Run デプロイ完了"
echo ""

# ==============================================================================
# デプロイ結果の表示
# ==============================================================================

log_info "🌐 デプロイ情報を取得中..."

# サービスURL取得
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
  --region=$REGION \
  --format='value(status.url)')

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_success "デプロイが正常に完了しました！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "🌐 AI Writer URL: ${SERVICE_URL}"
log_info "🔗 ヘルスチェック: ${SERVICE_URL}/api/health"
log_info "🔐 ログイン: ${SERVICE_URL}/login"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ヘルスチェック実行
log_info "🏥 ヘルスチェックを実行中..."
sleep 5  # サービス起動を待つ

HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health")

if [ "$HEALTH_RESPONSE" = "200" ]; then
  log_success "ヘルスチェック成功 (HTTP ${HEALTH_RESPONSE})"
else
  log_warning "ヘルスチェック失敗 (HTTP ${HEALTH_RESPONSE})"
  log_info "サービスが起動するまで数分かかる場合があります"
fi

echo ""
log_info "📊 詳細ログを確認するには:"
echo "   gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=50"
echo ""

exit 0
