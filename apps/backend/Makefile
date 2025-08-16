# Revolution Backend Makefile
# WordPress Docker環境の管理

.PHONY: sync-scripts build up down logs clean

# スクリプト同期
sync-scripts:
	@echo "📄 Syncing scripts from ../../scripts/"
	cp ../../scripts/setup-wordpress.sh ./setup-wordpress.sh
	chmod +x ./setup-wordpress.sh
	@echo "✅ Scripts synced successfully"

# Dockerビルド（スクリプト同期付き）
build: sync-scripts
	@echo "🔨 Building Docker image with latest scripts..."
	docker-compose build --no-cache
	@echo "✅ Build completed"

# 起動
up: build
	@echo "🚀 Starting WordPress environment..."
	docker-compose up -d
	@echo "✅ WordPress available at http://localhost:8080"

# 停止(データは引き継ぐ)
stop:
	@echo "🛑 Stopping WordPress environment..."
	docker-compose stop

# 停止(データも消える)
down:
	@echo "🛑 Stopping WordPress environment..."
	docker-compose down

# ログ表示
logs:
	docker-compose logs -f

# 完全クリーンアップ
clean:
	@echo "🧹 Cleaning up Docker resources..."
	docker-compose down -v
	docker image prune -f
	@echo "✅ Cleanup completed"

# ヘルプ
help:
	@echo "Available commands:"
	@echo "  make sync-scripts  - Sync scripts from ../../scripts/"
	@echo "  make build        - Build Docker image with latest scripts"
	@echo "  make up           - Build and start WordPress environment"
	@echo "  make down         - Stop WordPress environment"
	@echo "  make logs         - Show container logs"
	@echo "  make clean        - Clean up all Docker resources"
