# Revolution Project - Root Makefile
# Turbo + Make 統合管理

.PHONY: help dev build deploy clean setup test stop stop-frontend stop-backend docs-sync docs-create

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
	@echo "  make stop         - 全サービス停止"
	@echo "  make stop-frontend - フロントエンドのみ停止"
	@echo "  make stop-backend - バックエンドのみ停止"
	@echo "  make restart-all  - 全体再起動"
	@echo "  make restart-backend  - バックエンドのみ再起動"
	@echo "  make restart-frontend - フロントエンドのみ再起動"
	@echo "  make clean        - 環境クリーンアップ"
	@echo "  make status       - 環境状態確認"
	@echo ""
	@echo "📚 ドキュメント管理:"
	@echo "  make docs-sync    - iPadへドキュメント同期"
	@echo "  make docs-create  - ドキュメント作成+同期"

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
	@echo "🌐 Next.js Frontend:   http://localhost:4444"
	@echo ""
	@echo "💡 Tips:"
	@echo "  - Backend logs: make logs"
	@echo "  - Frontend only: pnpm dev:frontend"
	@echo "  - Code quality: pnpm lint && pnpm type-check"
	@echo ""
	@echo "📝 Note:"
	@echo "  - Default ports are listed above. If you’re running multiple apps, check your terminal for the actual ports."

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

# 停止コマンド
stop: stop-backend stop-frontend
	@echo "🛑 All services stopped!"

stop-frontend:
	@echo "⚛️ Stopping Next.js frontend..."
	@pkill -f "next dev" || true
	@echo "✅ Frontend stopped!"

stop-backend:
	@echo "🐳 Stopping WordPress backend (Docker)..."
	@cd apps/backend && make stop
	@echo "✅ Backend stopped!"

# 停止と再起動
restart-backend:
	@echo "🐳 Restarting WordPress backend (Docker)..."
	@cd apps/backend && make stop
	@cd apps/backend && make build
	@cd apps/backend && make up
	@echo "✅ Backend restarted!"

restart-frontend:
	@echo "⚛️ Restarting Next.js frontend..."
	@pkill -f "next dev" || true
	@sleep 2
	@pnpm dev:frontend &
	@echo "✅ Frontend restarted!"

restart-all: restart-backend restart-frontend
	@echo "🎉 All services restarted!"

# 環境状態確認
status:
	@echo "📊 Revolution Project Status"
	@echo "============================"
	@echo "🐳 Backend (Docker):"
	@cd apps/backend && docker-compose ps 2>/dev/null || echo "  ❌ Not running"
	@echo ""
	@echo "⚛️  Frontend (Next.js):"
	@lsof -ti:4444 >/dev/null 2>&1 && echo "  ✅ Running on :4444" || echo "  ❌ Not running"
	@echo ""
	@echo "💡 Quick commands:"
	@echo "  make dev      - Start full environment"
	@echo "  pnpm lint     - Code quality (Turbo)"
	@echo "  make status   - Check this status"

# ドキュメント管理
docs-sync:
	@echo "📚 Syncing documents to iCloud..."
	@./scripts/sync-docs-to-icloud.sh

docs-create:
	@echo "📝 Document creation helper"
	@echo "Usage: make docs-create TYPE=docs PATH=04-backend/BE-new-feature.md"
	@if [ -z "$(TYPE)" ] || [ -z "$(PATH)" ]; then \
		echo "❌ Required parameters missing!"; \
		echo "Example: make docs-create TYPE=docs PATH=04-backend/BE-new-feature.md"; \
		echo "         make docs-create TYPE=private PATH=04-backend/BE-secret.md"; \
		exit 1; \
	fi
	@./scripts/create-doc-and-sync.sh $(TYPE) $(PATH)
