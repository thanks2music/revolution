# Stage 1: 依存関係のインストール
FROM node:20-alpine AS deps
WORKDIR /app

# pnpm インストール
RUN corepack enable && corepack prepare pnpm@latest --activate

# 依存関係のみをコピーしてインストール（キャッシュ最適化）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: ビルド
FROM node:20-alpine AS builder
WORKDIR /app

# pnpm インストール
RUN corepack enable && corepack prepare pnpm@latest --activate

# 依存関係をコピー
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js テレメトリーを無効化
ENV NEXT_TELEMETRY_DISABLED=1

# ビルド実行
RUN pnpm build

# Stage 3: 本番環境
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# セキュリティのため非rootユーザーを作成
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Standalone出力をコピー
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Firebase設定ファイルをコピー（必要な場合）
COPY --from=builder --chown=nextjs:nodejs /app/firebase.json ./firebase.json
COPY --from=builder --chown=nextjs:nodejs /app/.firebaserc ./.firebaserc
COPY --from=builder --chown=nextjs:nodejs /app/firestore.rules ./firestore.rules
COPY --from=builder --chown=nextjs:nodejs /app/firestore.indexes.json ./firestore.indexes.json
COPY --from=builder --chown=nextjs:nodejs /app/storage.rules ./storage.rules

USER nextjs

EXPOSE 8080

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
