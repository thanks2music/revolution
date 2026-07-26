# Stage 1: 依存関係のインストール
FROM node:24-alpine AS deps
WORKDIR /app

# pnpm インストール
# バージョンはルート package.json の packageManager と一致させること
# (corepack 公式: packageManager フィールドが install の決定性を担保する)
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# モノレポ対応: ルートとワークスペース設定をコピー
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./

# ai-writerのpackage.jsonをコピー
COPY apps/ai-writer/package.json ./apps/ai-writer/

# shared/schemas は ai-writer のワークスペース依存 (@revolution/schemas: workspace:*)。
# package.json が無いと pnpm がワークスペースリンクを張れず、ビルド時に
# 'Module not found: @revolution/schemas/*' となる
COPY shared/schemas/package.json ./shared/schemas/

# pnpm node-linker=hoisted でシンボリックリンクを実体化
ENV PNPM_NODE_LINKER=hoisted

# 依存関係インストール（ワークスペースを考慮）
RUN pnpm install --frozen-lockfile --filter=@revolution/ai-writer...

# Stage 2: ビルド
FROM node:24-alpine AS builder
WORKDIR /app

# pnpm インストール
# バージョンはルート package.json の packageManager と一致させること
# (corepack 公式: packageManager フィールドが install の決定性を担保する)
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# 依存関係をコピー
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/ai-writer/node_modules ./apps/ai-writer/node_modules
# shared/schemas の依存 (zod / drizzle-zod / drizzle-orm) は root へ hoist されず
# /app/shared/schemas/node_modules に symlink として置かれるため、個別にコピーする。
# これが無いと transpilePackages が .ts を読めても import 先を解決できず
# 'Module not found: zod / drizzle-orm / drizzle-zod' でビルドが落ちる。
# deps ステージの COPY shared/schemas/package.json と対で維持すること
COPY --from=deps /app/shared/schemas/node_modules ./shared/schemas/node_modules

# ルート設定ファイルをコピー
COPY pnpm-workspace.yaml ./
COPY package.json ./

# shared/schemas の実体をコピー。exports が .ts を直接指しており、
# ai-writer の next.config.ts が transpilePackages: ['@revolution/schemas'] で
# ソースを直接 transpile するため、ビルド時に実ファイルが必要
COPY shared ./shared

# ai-writerアプリをコピー
COPY apps/ai-writer ./apps/ai-writer

# ビルド時に環境変数を受け取る（ARG）
# NEXT_PUBLIC_ prefix の変数はクライアント側にバンドルされる
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

# ENV に設定してビルド時に利用可能にする
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID

# 注意: ALLOWED_EMAILS は実行時にSecret Managerから渡されるため、ここでは設定しない

# Next.js テレメトリーを無効化
ENV NEXT_TELEMETRY_DISABLED=1

# ビルド実行（ai-writerディレクトリで）
WORKDIR /app/apps/ai-writer
RUN pnpm build

# Stage 3: 本番環境
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# Next.js standalone の server.js は PORT 未設定時 3000 で待ち受けるため、
# EXPOSE / HEALTHCHECK が指す 8080 と揃える。
# Cloud Run は実行時に PORT を注入するのでそちらが優先される (公式 container contract)
ENV PORT=8080

# セキュリティのため非rootユーザーを作成
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Standalone出力をコピー（モノレポ構造を維持）
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/.next/static ./apps/ai-writer/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/ai-writer/public ./apps/ai-writer/public

USER nextjs

EXPOSE 8080

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "apps/ai-writer/server.js"]
