# GitHub Actions CI/CD パイプライン実装ガイド

## 概要

Revolution プロジェクトにおける GitHub Actions を活用した完全自動化 CI/CD パイプラインの実装予定集。モノレポ構成を活かし、フロントエンド（Next.js）とバックエンド（WordPress）の統合的な自動化を目指します。

## 実装価値・メリット

### 開発効率の向上
- **自動テスト**: プッシュごとにコード品質を自動検証
- **自動デプロイ**: 手動作業を削減し、ヒューマンエラーを防止
- **並列処理**: フロントエンド/バックエンドの並列ビルドで時間短縮

### 品質保証
- **一貫性**: 環境差異によるバグを防止
- **トレーサビリティ**: デプロイ履歴の完全な記録
- **ロールバック**: 問題発生時の迅速な復旧

## 提案するワークフロー構成

```yaml
.github/
├── workflows/
│   ├── ci.yml                    # CI（継続的インテグレーション）
│   ├── deploy-frontend.yml       # Next.js デプロイ
│   ├── deploy-backend.yml        # WordPress デプロイ
│   ├── pr-preview.yml           # PR プレビュー環境
│   ├── security-scan.yml        # セキュリティスキャン
│   └── scheduled-maintenance.yml # 定期メンテナンス
├── actions/
│   ├── setup-monorepo/          # モノレポセットアップ
│   └── notify-slack/            # Slack 通知
└── dependabot.yml               # 依存関係の自動更新
```

## 実装詳細

### 1. CI パイプライン（全コミット実行）

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop, 'feature/**']
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  # ========== 変更検出 ==========
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      frontend: ${{ steps.filter.outputs.frontend }}
      backend: ${{ steps.filter.outputs.backend }}
      docs: ${{ steps.filter.outputs.docs }}
    steps:
      - uses: actions/checkout@v4
      
      - uses: dorny/paths-filter@v2
        id: filter
        with:
          filters: |
            frontend:
              - 'apps/frontend/**'
              - 'package.json'
              - 'pnpm-lock.yaml'
            backend:
              - 'apps/backend/**'
              - 'Dockerfile'
            docs:
              - 'docs/**'
              - 'README.md'

  # ========== フロントエンドテスト ==========
  test-frontend:
    needs: detect-changes
    if: needs.detect-changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [20.x, 22.x]
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v2
        with:
          version: 10.11.0
      
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Type check
        run: pnpm type-check
      
      - name: Lint
        run: pnpm lint
      
      - name: Unit tests
        run: pnpm test:unit
        env:
          CI: true
      
      - name: Build test
        run: pnpm build:frontend
      
      - name: Bundle size check
        uses: andresz1/size-limit-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          directory: apps/frontend

  # ========== バックエンドテスト ==========
  test-backend:
    needs: detect-changes
    if: needs.detect-changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test
          MYSQL_DATABASE: wordpress_test
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Build Docker image
        run: |
          cd apps/backend
          docker build -t wordpress-test:latest .
      
      - name: Run WordPress container
        run: |
          docker run -d \
            --name wordpress-test \
            -p 8080:8080 \
            -e DB_HOST=host.docker.internal \
            -e DB_NAME=wordpress_test \
            -e DB_USER=root \
            -e DB_PASSWORD=test \
            wordpress-test:latest
      
      - name: Health check
        run: |
          timeout 60 bash -c 'until curl -f http://localhost:8080/health.php; do sleep 2; done'
      
      - name: GraphQL test
        run: |
          curl -X POST http://localhost:8080/graphql \
            -H "Content-Type: application/json" \
            -d '{"query": "{ generalSettings { title } }"}' \
            | grep -q "generalSettings"

  # ========== セキュリティスキャン ==========
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'sarif'
          output: 'trivy-results.sarif'
      
      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
```

### 2. フロントエンドデプロイ（Vercel）

```yaml
# .github/workflows/deploy-frontend.yml
name: Deploy Frontend to Vercel

on:
  push:
    branches: [main]
    paths:
      - 'apps/frontend/**'
      - '.github/workflows/deploy-frontend.yml'
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'production'
        type: choice
        options:
          - production
          - staging
          - development

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'production' }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v2
        with:
          version: 10.11.0
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build application
        run: pnpm build:frontend
        env:
          NEXT_PUBLIC_WP_ENDPOINT: ${{ secrets.WP_GRAPHQL_ENDPOINT }}
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: ${{ github.event.inputs.environment == 'production' && '--prod' || '' }}
          working-directory: ./apps/frontend
      
      - name: Lighthouse CI
        uses: treosh/lighthouse-ci-action@v10
        with:
          urls: |
            ${{ steps.deploy.outputs.url }}
            ${{ steps.deploy.outputs.url }}/post/sample
          uploadArtifacts: true
          temporaryPublicStorage: true
```

### 3. バックエンドデプロイ（Cloud Run）

```yaml
# .github/workflows/deploy-backend.yml
name: Deploy Backend to Cloud Run

on:
  push:
    branches: [main]
    paths:
      - 'apps/backend/**'
      - '.github/workflows/deploy-backend.yml'
  workflow_dispatch:

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  SERVICE: wordpress-backend
  REGION: asia-northeast1

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    
    steps:
      - uses: actions/checkout@v4
      
      - id: auth
        uses: google-github-actions/auth@v1
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
      
      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v1
      
      - name: Configure Docker
        run: gcloud auth configure-docker
      
      - name: Build and Push Image
        run: |
          cd apps/backend
          IMAGE="gcr.io/$PROJECT_ID/$SERVICE:$GITHUB_SHA"
          docker build -t $IMAGE .
          docker push $IMAGE
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy $SERVICE \
            --image gcr.io/$PROJECT_ID/$SERVICE:$GITHUB_SHA \
            --platform managed \
            --region $REGION \
            --service-account ${{ secrets.CLOUD_RUN_SA }} \
            --add-cloudsql-instances ${{ secrets.CLOUDSQL_CONNECTION }} \
            --update-secrets=DB_PASSWORD=db-password:latest \
            --update-env-vars BUCKET_NAME=${{ secrets.GCS_BUCKET }}
      
      - name: Smoke test
        run: |
          URL=$(gcloud run services describe $SERVICE --region $REGION --format 'value(status.url)')
          curl -f $URL/health.php || exit 1
```

### 4. PR プレビュー環境

```yaml
# .github/workflows/pr-preview.yml
name: PR Preview Environment

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  preview-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v2
        with:
          version: 10.11.0
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      
      - name: Install and Build
        run: |
          pnpm install --frozen-lockfile
          pnpm build:frontend
      
      - name: Deploy Preview
        uses: amondnet/vercel-action@v25
        id: vercel-deploy
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: ./apps/frontend
          alias-domains: pr-${{ github.event.pull_request.number }}.revolution.vercel.app
      
      - name: Comment PR
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `🚀 Preview deployed to: ${process.env.PREVIEW_URL}\n\n` +
                    `Lighthouse scores:\n` +
                    `- Performance: ${process.env.LIGHTHOUSE_PERFORMANCE}\n` +
                    `- Accessibility: ${process.env.LIGHTHOUSE_ACCESSIBILITY}\n` +
                    `- Best Practices: ${process.env.LIGHTHOUSE_BEST_PRACTICES}\n` +
                    `- SEO: ${process.env.LIGHTHOUSE_SEO}`
            })
        env:
          PREVIEW_URL: ${{ steps.vercel-deploy.outputs.url }}
```

### 5. セキュリティスキャン（定期実行）

```yaml
# .github/workflows/security-scan.yml
name: Security Scanning

on:
  schedule:
    - cron: '0 2 * * 1'  # 毎週月曜日 AM 2:00
  workflow_dispatch:

jobs:
  dependency-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run npm audit
        run: |
          cd apps/frontend
          npm audit --audit-level=moderate
      
      - name: OWASP Dependency Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          project: 'Revolution'
          path: '.'
          format: 'HTML'
      
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: dependency-check-report
          path: reports/
  
  container-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build Docker image
        run: |
          cd apps/backend
          docker build -t wordpress:scan .
      
      - name: Run Trivy scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'wordpress:scan'
          format: 'table'
          exit-code: '1'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'CRITICAL,HIGH'
```

### 6. 定期メンテナンス

```yaml
# .github/workflows/scheduled-maintenance.yml
name: Scheduled Maintenance

on:
  schedule:
    - cron: '0 3 * * 0'  # 毎週日曜日 AM 3:00
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - id: auth
        uses: google-github-actions/auth@v1
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - name: Clean up old Cloud Run revisions
        run: |
          gcloud run revisions list \
            --service=wordpress-backend \
            --region=asia-northeast1 \
            --format="value(name)" \
            --sort-by="~creationTimestamp" | \
          tail -n +4 | \
          xargs -I {} gcloud run revisions delete {} \
            --region=asia-northeast1 --quiet || true
      
      - name: Clean up old Container Registry images
        run: |
          # 30日以上古いイメージを削除
          gcloud container images list-tags \
            gcr.io/${{ secrets.GCP_PROJECT_ID }}/wordpress-backend \
            --filter="timestamp.datetime < $(date -d '30 days ago' --iso-8601)" \
            --format="get(digest)" | \
          xargs -I {} gcloud container images delete \
            "gcr.io/${{ secrets.GCP_PROJECT_ID }}/wordpress-backend@{}" \
            --quiet || true
  
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Backup Cloud SQL
        run: |
          gcloud sql backups create \
            --instance=wordpress-mysql \
            --description="Weekly automated backup $(date +%Y%m%d)"
      
      - name: Export WordPress content
        run: |
          # WordPress コンテンツのエクスポート
          curl -X POST ${{ secrets.WP_ENDPOINT }}/wp-json/wp/v2/export \
            -H "Authorization: Bearer ${{ secrets.WP_API_TOKEN }}" \
            -o backup-$(date +%Y%m%d).xml
      
      - name: Upload backup to GCS
        run: |
          gsutil cp backup-*.xml \
            gs://${{ secrets.BACKUP_BUCKET }}/wordpress/$(date +%Y%m%d)/
```

## GitHub Actions の高度な活用

### 1. マトリックスビルド戦略

```yaml
strategy:
  matrix:
    include:
      - environment: development
        node-version: 20.x
        deploy-flag: '--dev'
      - environment: staging
        node-version: 20.x
        deploy-flag: '--staging'
      - environment: production
        node-version: 22.x
        deploy-flag: '--prod'
```

### 2. キャッシュ最適化

```yaml
- name: Cache pnpm store
  uses: actions/cache@v3
  with:
    path: ~/.pnpm-store
    key: ${{ runner.os }}-pnpm-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: |
      ${{ runner.os }}-pnpm-

- name: Cache Next.js build
  uses: actions/cache@v3
  with:
    path: apps/frontend/.next/cache
    key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('**.[jt]s', '**.[jt]sx') }}
```

### 3. 並列ジョブ実行

```yaml
jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - id: set-matrix
        run: echo "matrix={\"app\":[\"frontend\",\"backend\"]}" >> $GITHUB_OUTPUT
  
  build:
    needs: prepare
    strategy:
      matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building ${{ matrix.app }}"
```

### 4. 環境別デプロイ

```yaml
on:
  push:
    branches:
      - main        # → production
      - staging     # → staging
      - develop     # → development

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: 
      name: ${{ github.ref_name == 'main' && 'production' || github.ref_name }}
      url: ${{ steps.deploy.outputs.url }}
```

## コスト最適化

### 1. セルフホストランナー活用

```yaml
runs-on: [self-hosted, linux, x64]
```

### 2. ジョブの条件付き実行

```yaml
if: |
  github.event_name == 'push' ||
  (github.event_name == 'pull_request' && github.event.action != 'closed')
```

### 3. アーティファクト管理

```yaml
- uses: actions/upload-artifact@v3
  with:
    name: build-artifacts
    path: dist/
    retention-days: 7  # 7日後に自動削除
```

## モニタリング・通知

### Slack 通知統合

```yaml
- name: Notify Slack
  if: always()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: |
      Repository: ${{ github.repository }}
      Workflow: ${{ github.workflow }}
      Status: ${{ job.status }}
      Commit: ${{ github.sha }}
      Author: ${{ github.actor }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
    icon_emoji: ':github:'
```

## 実装優先順位

### Phase 1（即実装可能）
1. CI パイプライン（テスト・Lint）
2. 依存関係の自動更新（Dependabot）
3. セキュリティスキャン

### Phase 2（環境準備後）
1. フロントエンド自動デプロイ
2. PR プレビュー環境
3. Slack 通知

### Phase 3（運用安定後）
1. バックエンド自動デプロイ
2. 定期メンテナンス
3. パフォーマンスモニタリング

## まとめ

GitHub Actions を活用することで、Revolution プロジェクトの開発効率と品質を大幅に向上させることができます。段階的な実装により、リスクを最小限に抑えながら、完全自動化された CI/CD パイプラインを構築できます。

## 関連ドキュメント

- [アーキテクチャ概要](../01-arch/ARCH-project-overview.md)
- [Cloud Run デプロイガイド](./CD-cloud-run-docker-deploy.md)
- [ビルドツール戦略](../07-build/BUILD-turbo-vs-make-strategy.md)
- [スクリプトアーキテクチャ](../06-ops/OPS-scripts-architecture.md)
