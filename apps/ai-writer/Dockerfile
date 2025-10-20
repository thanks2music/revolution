# Stage 1: 依存関係のインストール
FROM node:20-alpine AS deps
WORKDIR /app

# pnpm インストール
RUN corepack enable && corepack prepare pnpm@latest --activate

# モノレポ対応: ルートとワークスペース設定をコピー
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./

# ai-writerのpackage.jsonをコピー
COPY apps/ai-writer/package.json ./apps/ai-writer/

# pnpm node-linker=hoisted でシンボリックリンクを実体化
ENV PNPM_NODE_LINKER=hoisted

# 依存関係インストール（ワークスペースを考慮）
RUN pnpm install --frozen-lockfile --filter=@revolution/ai-writer...

# Stage 2: ビルド
FROM node:20-alpine AS builder
WORKDIR /app

# pnpm インストール
RUN corepack enable && corepack prepare pnpm@latest --activate

# 依存関係をコピー
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/ai-writer/node_modules ./apps/ai-writer/node_modules

# ルート設定ファイルをコピー
COPY pnpm-workspace.yaml ./
COPY package.json ./

# ai-writerアプリをコピー
COPY apps/ai-writer ./apps/ai-writer

# ビルド時に環境変数を受け取る（ARG）
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_ALLOWED_EMAILS

# ENV に設定してビルド時に利用可能にする
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_ALLOWED_EMAILS=$NEXT_PUBLIC_ALLOWED_EMAILS

# Next.js テレメトリーを無効化
ENV NEXT_TELEMETRY_DISABLED=1

# ビルド実行（ai-writerディレクトリで）
WORKDIR /app/apps/ai-writer
RUN pnpm build

# Stage 3: 本番環境
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

# セキュリティのため非rootユーザーを作成
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Standalone出力をコピー（モノレポ構造を維持）
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/.next/static ./apps/ai-writer/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/public ./apps/ai-writer/public

# Firebase設定ファイルをコピー（必要な場合）
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/firebase.json ./firebase.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/.firebaserc ./.firebaserc
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/firestore.rules ./firestore.rules
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/firestore.indexes.json ./firestore.indexes.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/storage.rules ./storage.rules

USER nextjs

EXPOSE 8080

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "apps/ai-writer/server.js"]
