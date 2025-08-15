# Revolution Project - Root Makefile
# Turbo + Make 統合管理

.PHONY: help dev build deploy clean setup test

# デフォルトターゲット
help:
	@echo "🚀 Revolution Project - 統合コマンド"
	@echo "===================================="
	@echo "📋 主要コマンド:"
	@echo "  make dev          - フルスタック開発環境"
	@echo "  make build        - 全コンポーネントビルド"
	@echo "  make deploy       - 本番デプロイ"
	@echo ""
	@echo "🔧 個別環境:"
	@echo "  pnpm dev:frontend - フロントエンドのみ (Turbo)"
	@echo "  pnpm dev:backend  - バックエンドのみ (Docker)"
	@echo ""
	@echo "⚡ 開発ツール (Turbo最適化):"
	@echo "  pnpm lint         - コード品質チェック"
	@echo "  pnpm type-check   - TypeScript型チェック"
	@echo "  pnpm test         - テスト実行"
	@echo ""
	@echo "🛠️  その他:"
	@echo "  make setup        - 初回セットアップ"
	@echo "  make clean        - 環境クリーンアップ"
	@echo "  make status       - 環境状態確認"

# 初回セットアップ
setup:
	@echo "🔧 Setting up Revolution project..."
	@echo "Installing dependencies..."
	pnpm install
	@echo "Setting up backend..."
	cd apps/backend && make sync-scripts
	@echo "✅ Setup completed!"
	@echo "Run 'make dev' to start development"

# 統合開発環境（メインコマンド）
dev: backend frontend-background
	@echo "🎉 Revolution Development Environment Ready!"
	@echo "==========================================="
	@echo "📝 WordPress Backend:  http://localhost:8080"
	@echo "🌐 Next.js Frontend:   http://localhost:3001"
	@echo ""
	@echo "💡 Tips:"
	@echo "  - Backend logs: make logs"
	@echo "  - Frontend only: pnpm dev:frontend"
	@echo "  - Code quality: pnpm lint && pnpm type-check"

# バックエンド起動（Docker管理）
backend:
	@echo "🐳 Starting WordPress backend (Docker)..."
	cd apps/backend && make up

# フロントエンドをバックグラウンドで起動（Turbo委譲）
frontend-background:
	@echo "⚛️  Starting Next.js frontend (Turbo)..."
	pnpm dev:frontend &

# Turboを活用したビルド
build: build-backend build-frontend
	@echo "✅ Full Revolution build completed!"

build-backend:
	@echo "🔨 Building backend (Docker)..."
	cd apps/backend && make build

build-frontend:
	@echo "🔨 Building frontend (Turbo optimized)..."
	pnpm build:frontend

# テスト（Turbo最適化）
test:
	@echo "🧪 Running tests (Turbo optimized)..."
	pnpm test

# 本番デプロイ（統合プロセス）
deploy: build
	@echo "🚀 Production deployment..."
	./scripts/generate-wp-secrets.sh
	./scripts/deploy.sh
	cd apps/frontend && vercel --prod
	@echo "✅ Deployment completed!"

# 環境クリーンアップ
clean:
	@echo "🧹 Cleaning all environments..."
	cd apps/backend && make clean
	pnpm turbo run clean
	@echo "✅ Cleanup completed!"

# ログ表示
logs:
	@echo "📋 Showing backend logs..."
	cd apps/backend && make logs

# 開発用便利コマンド
restart: clean dev
	@echo "🔄 Environment restarted!"

# 環境状態確認
status:
	@echo "📊 Revolution Project Status"
	@echo "============================"
	@echo "🐳 Backend (Docker):"
	@cd apps/backend && docker-compose ps 2>/dev/null || echo "  ❌ Not running"
	@echo ""
	@echo "⚛️  Frontend (Next.js):"
	@lsof -ti:3001 >/dev/null 2>&1 && echo "  ✅ Running on :3001" || echo "  ❌ Not running"
	@echo ""
	@echo "💡 Quick commands:"
	@echo "  make dev      - Start full environment"
	@echo "  pnpm lint     - Code quality (Turbo)"
	@echo "  make status   - Check this status"