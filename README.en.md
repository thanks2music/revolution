# Revolution

> **Languages**: [🇯🇵 日本語](README.md) | [🇬🇧 English](README.en.md)

![License](https://img.shields.io/badge/license-Personal%20Project-blue)

A modern Jamstack platform with AI-powered article generation. A personal challenge to build a next-generation web media system.

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Quick Start](#-quick-start)
- [Architecture](#️-architecture)
- [Roadmap](#️-roadmap)
- [Tech Stack](#️-tech-stack)
- [Project Structure](#-project-structure)
- [Development](#-development)
- [Deployment](#-deployment)
- [Troubleshooting](#️-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## 📖 Overview

**Revolution** is a next-generation Jamstack-based web media system developed as a personal project by [@thanks2music](https://github.com/thanks2music). It features an AI-powered article generation pipeline leveraging LLMs.

Built on the experience of manually creating over 10,000 articles, this project combines that practical knowledge with AI to explore a modern web application architecture that automates the entire workflow—from content creation to publication.

---

## ✨ Core Features

### MDX-Based Article Generation System (Current)

- 🤖 **AI Article Generation Pipeline**: RSS/URL → multi-step pipeline → MDX files → GitHub PRs
- 🔄 **Multi AI Provider Support**: Switchable via environment variables
  - Claude (Anthropic) — default
  - Gemini (Google)
  - OpenAI (GPT)

- 📝 **YAML Template System**: Prompt management using modular YAML that encapsulates the tacit knowledge of [@thanks2music](https://github.com/thanks2music)
- ⚡ **Static Site Generation (SSG) Optimized**:
  - DB-less architecture powered by MDX
  - High-speed article lookup via `article-index.json`
  - Seamless deployment to Vercel

- 🔐 **Secure Authentication**: Firebase Authentication with custom claims
- 🧪 **Test Coverage**: Comprehensive testing with Jest and Firebase Emulator
- 📊 **Monorepo Management**: Efficient workspace management using pnpm and Turbo

### 🗂️ Legacy Headless CMS Architecture

- 🤖 **AI Content Pipeline**: RSS ingestion → article generation via Claude, ChatGPT, Gemini APIs (Phase 0.1), Grok → LLM-based article generation (Claude, ChatGPT, Gemini) (Phase 1)
  - From Phase 0.1 onward, the pipeline is **MDX-only**.
- ⚡ **Headless CMS**: WordPress GraphQL API with Next.js SSG/ISR
  - “Headless WordPress” development was discontinued after git tag: `headless-wp-mvp-final-20251103` and is maintained as a legacy version.
  - To restore the Headless WordPress version, refer to the tag above.
  - ☁️ **Cloud-Native**: Containerized WordPress running on Google Cloud Run
- 🔐 **Security**: Firebase Authentication with custom claims
- 🧪 **Test Coverage**: Comprehensive unit testing with Jest and Firebase Emulator
- 📊 **Monorepo**: Efficient workspace management using pnpm and Turbo


---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: 20.0.0 or higher
- **pnpm**: 10.0.0 or higher
- **Docker**: For local WordPress development
- **Google Cloud SDK**: For Cloud Run deployment (optional)

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/revolution.git
cd revolution

# Install dependencies
pnpm install

# Setup environment variables
cp apps/ai-writer/.env.sample apps/ai-writer/.env.local
cp apps/frontend/.env.sample apps/frontend/.env.local

# Start development (all workspaces)
pnpm dev
```

### Key Environment Variables

#### AI Writer (`apps/ai-writer/.env.local`)

```bash
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com

# Anthropic API
ANTHROPIC_API_KEY=your_anthropic_api_key

# WordPress GraphQL Endpoint
NEXT_PUBLIC_WP_ENDPOINT=http://localhost:8080/graphql

# Admin Emails (comma-separated)
ADMIN_EMAILS=admin@example.com
```

#### Frontend (`apps/frontend/.env.local`)

```bash
# WordPress GraphQL Endpoint
NEXT_PUBLIC_WP_ENDPOINT=http://localhost:8080/graphql

# Image Optimization
ALLOWED_IMAGE_HOST=localhost
```

See `.env.sample` in each workspace for full details.

---

## 🏗️ Architecture

### System Diagram

```mermaid
graph TB
    subgraph "User Layer"
        U[Users]
    end

    subgraph "CDN Layer"
        CDN[CloudFlare CDN]
    end

    subgraph "Frontend Layer (Vercel)"
        FE1[Next.js Frontend<br/>v14.2 / React 18]
        FE2[AI Writer App<br/>v15.5 / React 19<br/>Port 7777]
    end

    subgraph "Backend Layer (Cloud Run)"
        WP[WordPress API<br/>PHP 8.4<br/>Port 8080]
    end

    subgraph "Data Layer (GCP)"
        DB[(Cloud SQL<br/>MySQL 8.0)]
        GCS[Cloud Storage<br/>Media Files<br/>⚠️ Migrating to Vercel Blob]
    end

    subgraph "AI & Auth"
        CLAUDE[Claude API]
        FB[Firebase Auth]
    end

    U --> CDN
    CDN --> FE1
    U --> FE2
    FE1 --> WP
    FE2 --> WP
    FE2 --> CLAUDE
    FE2 --> FB
    WP --> DB
    WP --> GCS

    style U fill:#e1f5fe
    style CDN fill:#b3e5fc
    style FE1 fill:#f3e5f5
    style FE2 fill:#f3e5f5
    style WP fill:#c8e6c9
    style CLAUDE fill:#fff9c4
    style DB fill:#ffe0b2
    style GCS fill:#ffe0b2
    style FB fill:#ffccbc
```

### Data Flow: AI Article Generation

```mermaid
sequenceDiagram
    participant User
    participant AIWriter as AI Writer<br/>(Vercel)
    participant RSS as RSS Parser
    participant Claude as Claude API
    participant WP as WordPress GraphQL<br/>(Cloud Run)
    participant GCS as Cloud Storage

    User->>AIWriter: Trigger Auto-Generation
    AIWriter->>RSS: Fetch RSS Feeds
    RSS-->>AIWriter: Return Articles
    AIWriter->>AIWriter: Validate Articles<br/>(Keywords, Japanese)
    AIWriter->>Claude: Generate Article<br/>(Template-based)
    Claude-->>AIWriter: Return Generated Content
    AIWriter->>WP: Upload Media
    WP->>GCS: Store Images
    GCS-->>WP: Return URLs
    AIWriter->>WP: Create Post<br/>(GraphQL Mutation)
    WP-->>AIWriter: Return Post ID
    AIWriter-->>User: Success
```

---

## 🛠️ Tech Stack

### Frontend Applications

| Component | Technology | Version | Purpose |
|-----------|-----------|----------|---------|
| **Main Frontend** | Next.js / React / TypeScript | 14.2 / 18 / 5 | Public-facing website |
| **AI Writer** | Next.js / React / TypeScript | 15.5 / 19 / 5 | Content generation admin |
| **Styling** | Tailwind CSS | Latest | UI Design |
| **State Management** | SWR | 2.2+ | Data Fetching |

### Backend & Infrastructure

| Component | Technology | Details |
|-----------|-----------|---------|
| **CMS** | WordPress 6.7 / PHP 8.4 | Headless mode with GraphQL |
| **Database** | Cloud SQL (MySQL 8.0) | Cost-optimized tier |
| **Storage** | Cloud Storage | Public media files (migrating to Vercel Blob) |
| **Container** | Docker / Cloud Run | Multi-stage builds |
| **Auth** | Firebase Authentication | Custom claims for authorization |
| **CDN** | CloudFlare | Static asset delivery |

### AI & Integration

| Service | Purpose | Package |
|---------|---------|---------|
| **Claude API** | Article generation | `@anthropic-ai/sdk` |
| **RSS Parser** | Feed collection | `rss-parser` |
| **Article Extractor** | URL content extraction | `@extractus/article-extractor` |
| **GraphQL Codegen** | Type-safe WordPress API | `@graphql-codegen/*` |

### Development Tools

| Tool | Version | Purpose |
|------|---------|---------|
| **pnpm** | 10.11.0+ | Fast package manager |
| **Turbo** | 2.5+ | Monorepo build system |
| **Jest** | 30.2+ | Unit testing |
| **Firebase Emulator** | Latest | Local auth/db testing |
| **ESLint + Prettier** | Latest | Code quality |

---

## 📁 Project Structure

```
revolution/
├── apps/
│   ├── ai-writer/              # AI Content Generation Admin App (Next.js 15.5)
│   ├── backend/                # WordPress Headless CMS (Cloud Run)
│   ├── frontend/               # Main Next.js Website (Next.js 14.2)
│   └── mcp-gcp-server/         # Model Context Protocol Server
│
├── shared/                     # Shared code across workspaces
│   ├── types/                  # Common TypeScript types
│   └── utils/                  # Utility functions
│
├── scripts/                    # Automation scripts
│   ├── sync-docs-to-icloud.sh  # Documentation sync
│   └── create-doc-and-sync.sh  # Doc creation helper
│
├── package.json                # Root package config
├── pnpm-workspace.yaml         # Workspace configuration
└── turbo.json                  # Turbo cache config
```

---

## 💻 Development

### Root Level (Monorepo)

```bash
# Start development server (all workspaces)
pnpm dev

# Start specific workspace only
pnpm dev:frontend     # Frontend only
pnpm dev:ai-writer    # AI Writer only

# Build
pnpm build            # All workspaces
pnpm build:frontend   # Frontend only

# Testing & Quality
pnpm test             # Run all tests
pnpm lint             # Lint all workspaces
pnpm type-check       # TypeScript validation

# Cleanup
pnpm clean            # Clean build artifacts
pnpm fresh            # Clean install
```

### AI Writer App

```bash
cd apps/ai-writer

# Development
pnpm dev              # Start on port 7777
pnpm restart          # Kill & restart

# Testing
pnpm test             # Run Jest tests
pnpm test:watch       # Watch mode
pnpm test:coverage    # Coverage report

# GraphQL Code Generation
pnpm codegen          # Generate types from schema

# Firebase Admin
pnpm admin:setup      # Setup admin users
pnpm admin:list       # List admins
```

### Backend (WordPress)

```bash
cd apps/backend

# Local Development
docker-compose up -d          # Start containers
docker-compose logs -f        # View logs
docker-compose down           # Stop containers

# Deployment
./scripts/deploy.sh           # Deploy to Cloud Run
```

Detailed development guide: [docs/06-ops/](docs/06-ops/)

---

## 🚢 Deployment

### Frontend (Vercel)

```bash
cd apps/frontend
vercel --prod

# Or from root
pnpm deploy:frontend
```

### Backend (Cloud Run)

```bash
cd apps/backend
./scripts/deploy.sh

# Or from root
pnpm deploy:backend
```

**⚠️ Important**: Do NOT use root `scripts/deploy.sh` - it's incomplete. Always use `apps/backend/scripts/deploy.sh`.

### AI Writer (Vercel)

```bash
cd apps/ai-writer
vercel --prod
```

Detailed deployment guide: [docs/08-cicd/](docs/08-cicd/)

---

## ⚠️ Troubleshooting

### Development Server Won't Start

**Symptom**: Error when running `pnpm dev`

**Solution**:
1. Check Node.js version: `node --version` (requires 20.0.0+)
2. Reinstall dependencies: `pnpm fresh`
3. Check port conflicts: `lsof -i :7777` (AI Writer) / `lsof -i :3000` (Frontend)
4. Force restart: `pnpm restart`

### Cannot Connect to WordPress GraphQL Endpoint

**Symptom**: `Failed to fetch from WordPress GraphQL`

**Solution**:
1. Verify WordPress container is running:
   ```bash
   docker ps | grep wordpress
   ```

2. Test GraphQL endpoint:
   ```bash
   curl -X POST http://localhost:8080/graphql \
     -H "Content-Type: application/json" \
     -d '{"query": "{ posts { edges { node { title } } } }"}'
   ```

3. Check environment variables:
   ```bash
   # apps/ai-writer/.env.local or apps/frontend/.env.local
   NEXT_PUBLIC_WP_ENDPOINT=http://localhost:8080/graphql
   ```

### Firebase Authentication Error

**Symptom**: `Firebase: Error (auth/invalid-api-key)`

**Solution**:
1. Check Firebase config: `apps/ai-writer/.env.local`
2. Verify Firebase Admin SDK environment variables:
   ```bash
   FIREBASE_PROJECT_ID=your_project_id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your_project.iam.gserviceaccount.com
   ```
3. Setup admin: `cd apps/ai-writer && pnpm admin:setup`

### Port 8080 Conflict

**Symptom**: `Error: listen EADDRINUSE: address already in use :::8080`

**Solution**:
```bash
# Check process using the port
lsof -i :8080

# Kill the process
kill -9 <PID>

# Or stop Docker containers
docker-compose down
```

### Debug Logs in Production

**Security Note**: Remove debug logs before production deployment:

```typescript
// apps/ai-writer/lib/firebase/admin.ts
// ❌ Remove in production
console.log('[Firebase Admin] Project ID:', process.env.FIREBASE_PROJECT_ID);
```

Detailed troubleshooting: [docs/06-ops/OPS-troubleshooting.md](docs/06-ops/)

---

## Development Workflow

1. Create feature branch: `git checkout -b feature/your-feature-name`
2. Make changes with conventional commits: `git commit -m "feat: add new feature"`
3. Run tests: `pnpm test`
4. Create pull request to `main`

### Commit Convention

```bash
✨ feat:      Add new feature
🐛 fix:       Bug fix
📝 docs:      Documentation
🔧 config:    Configuration changes
♻️  refactor:  Code refactoring
🧪 test:      Add tests
🎨 style:     Code formatting
⚡️ perf:      Performance improvement
```

---

## 🙏 Acknowledgments

Built with:

- [Next.js](https://nextjs.org/) - React framework
- [WordPress](https://wordpress.org/) - CMS
- [WPGraphQL](https://www.wpgraphql.com/) - GraphQL for WordPress
- [Anthropic Claude](https://www.anthropic.com/) - AI API
- [Firebase](https://firebase.google.com/) - Authentication
- [Google Cloud](https://cloud.google.com/) - Infrastructure
- [Vercel](https://vercel.com/) - Deployment platform

---

**Happy Coding! 🚀**
