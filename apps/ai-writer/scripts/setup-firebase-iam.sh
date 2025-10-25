#!/bin/bash
set -e

# ==============================================================================
# Revolution AI Writer (Discovery) - Firebase IAM セットアップスクリプト
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
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-t4v-revo-prd}"
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-revolution-discovery}"
export SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT:-revo-wordpress-app}"
export SERVICE_ACCOUNT="${SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

log_info "🔐 Revolution AI Writer - Firebase IAM セットアップ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "GCP Project ID: ${GCP_PROJECT_ID}"
log_info "Firebase Project ID: ${FIREBASE_PROJECT_ID}"
log_info "Service Account: ${SERVICE_ACCOUNT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ==============================================================================
# 前提条件チェック
# ==============================================================================

log_info "🔍 前提条件をチェック中..."

# Firebase プロジェクトが存在するか確認
if ! gcloud projects describe $FIREBASE_PROJECT_ID &>/dev/null; then
  log_error "Firebase プロジェクト '${FIREBASE_PROJECT_ID}' が見つかりません"
  log_info "Firebase Console で確認してください: https://console.firebase.google.com"
  exit 1
fi

log_success "前提条件チェック完了"
echo ""

# ==============================================================================
# 1. Firebase Admin 権限の付与
# ==============================================================================

log_info "📝 1. Firebase Admin 権限の付与"
echo ""

log_info "Service Account に Firebase Admin 権限を付与中..."

gcloud projects add-iam-policy-binding $FIREBASE_PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/firebase.admin" \
  --quiet

log_success "Firebase Admin 権限を付与しました"
echo ""

# ==============================================================================
# 2. Firestore アクセス権限の付与
# ==============================================================================

log_info "📝 2. Firestore アクセス権限の付与"
echo ""

log_info "Service Account に Firestore User 権限を付与中..."

gcloud projects add-iam-policy-binding $FIREBASE_PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/datastore.user" \
  --quiet

log_success "Firestore User 権限を付与しました"
echo ""

# ==============================================================================
# 3. Firebase Authentication 権限の付与
# ==============================================================================

log_info "📝 3. Firebase Authentication 権限の付与"
echo ""

log_info "Service Account に Firebase Authentication Admin 権限を付与中..."

gcloud projects add-iam-policy-binding $FIREBASE_PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/firebaseauth.admin" \
  --quiet

log_success "Firebase Authentication Admin 権限を付与しました"
echo ""

# ==============================================================================
# 4. Firebase Storage 権限の付与
# ==============================================================================

log_info "📝 4. Firebase Storage 権限の付与"
echo ""

log_info "Service Account に Storage Object Admin 権限を付与中..."

gcloud projects add-iam-policy-binding $FIREBASE_PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/storage.objectAdmin" \
  --quiet

log_success "Storage Object Admin 権限を付与しました"
echo ""

# ==============================================================================
# 5. 権限の確認
# ==============================================================================

log_info "📊 付与された権限の確認"
echo ""

log_info "Service Account: ${SERVICE_ACCOUNT}"
log_info "付与された権限:"
echo ""

gcloud projects get-iam-policy $FIREBASE_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:${SERVICE_ACCOUNT}" \
  --format="table(bindings.role)" 2>/dev/null || log_warning "権限の確認に失敗しました"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_success "Firebase IAM のセットアップが完了しました！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "次のステップ: デプロイを実行してください"
echo "  cd apps/ai-writer"
echo "  pnpm deploy"
echo ""
log_info "または、ローカルでDockerビルドをテストしてください"
echo "  pnpm docker:build"
echo ""

exit 0
