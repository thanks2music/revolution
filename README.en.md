<p align="center">
  <a href="https://github.com/thanks2music/revolution">
    <img src="apps/frontend/public/images/og-image-compressed.png" width="100%" alt="Revolution">
  </a>
</p>

# Revolution

> **Languages**: [🇯🇵 日本語](README.md) | [🇬🇧 English](README.en.md)

![License](https://img.shields.io/badge/license-Personal%20Project-blue)
![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![pnpm](https://img.shields.io/badge/pnpm-10-f69220?logo=pnpm)
![Turbo](https://img.shields.io/badge/Turbo-2.5-00d49a)

A next-generation Jamstack web media platform with an LLM-powered AI article generation pipeline. A personal project by [@thanks2music](https://github.com/thanks2music) — a playground for modern web application architecture.

## What is Revolution?

Built on the experience of manually creating over 10,000 articles, Revolution distills that practical knowledge into LLMs and modular YAML templates. The system automates the full content lifecycle through a pipeline of **RSS / URL → 9-step pipeline → MDX files → GitHub PRs**. Articles are stored as MDX files (no database) and served via Next.js static site generation (SSG).

## Documentation

> Most detailed docs are written in Japanese.

| Topic | Link |
|---|---|
| MDX pipeline (9 steps + Mermaid diagrams) | [`docs/01-arch/ARCH-mdx-pipeline.md`](./docs/01-arch/ARCH-mdx-pipeline.md) |
| Current tech stack | [`docs/01-arch/ARCH-current-stack.md`](./docs/01-arch/ARCH-current-stack.md) |
| Architecture (incl. historical context) | [`docs/01-arch/`](./docs/01-arch/) |
| Monorepo & branch protection | [`docs/02-mono/`](./docs/02-mono/) |
| Cloud infrastructure (GCP / Cloud Run) | [`docs/03-cloud-infrastructure/`](./docs/03-cloud-infrastructure/) |
| Frontend (Next.js 16 / type definitions) | [`docs/05-frontend/`](./docs/05-frontend/) |
| Development & build commands | [`docs/07-build/BUILD-commands.md`](./docs/07-build/BUILD-commands.md) |
| CI/CD (AI Writer Cloud Run / Vercel) | [`docs/08-cicd/`](./docs/08-cicd/) |
| LLM tooling (Claude Code etc.) | [`docs/11-llm/`](./docs/11-llm/) |
| Full document index | [`docs/README.md`](./docs/README.md) |

For release notes, see [GitHub Releases](https://github.com/thanks2music/revolution/releases).

## Quick Start

```bash
# Clone the repository
git clone https://github.com/thanks2music/revolution.git
cd revolution

# Install dependencies
pnpm install

# Set up environment variables
cp apps/ai-writer/.env.sample apps/ai-writer/.env.local
cp apps/frontend/.env.sample apps/frontend/.env.local

# Start dev servers from the repo root (one shot)
pnpm dev                      # Frontend (http://localhost:4444) + AI Writer (http://localhost:7777) in parallel

# Or start them individually
pnpm dev:frontend             # Public frontend only
pnpm dev:ai-writer            # AI Writer only
```

> 💡 If you run multiple worktrees in parallel, use `bash scripts/worktree-dev.sh frontend` / `bash scripts/worktree-dev.sh ai-writer` to avoid port collisions. `pnpm dev` always uses the default ports (4444 / 7777).

See [`docs/07-build/BUILD-commands.md`](./docs/07-build/BUILD-commands.md) for the full command reference.

## Tech Stack

- **Frontend**: Next.js 16 / React 19 / TypeScript 5 / Tailwind CSS / SWR
- **AI Providers**: Claude (Anthropic) · Gemini (Google) · OpenAI (switchable via env var)
- **Infra**: Google Cloud Run / Firebase Authentication / Vercel / CloudFlare CDN
- **Tooling**: pnpm 10 / Turbo 2.5 / Jest 30 / ESLint 9

For the detailed table see [`docs/01-arch/ARCH-current-stack.md`](./docs/01-arch/ARCH-current-stack.md).

## Project Structure

```
revolution/
├── apps/
│   ├── ai-writer/   # AI article generation admin app (Next.js 16 / React 19)
│   ├── frontend/    # Public web site (Next.js 16 / React 19)
│   └── mcp-gcp-server/  # Model Context Protocol server
├── docs/            # Public documentation
├── shared/          # Type definitions & utilities (workspace-wide)
├── scripts/         # Automation scripts
└── .github/workflows/  # CI/CD pipelines
```

## Acknowledgments

Built with [Next.js](https://nextjs.org/) · [Anthropic Claude](https://www.anthropic.com/) · [Firebase](https://firebase.google.com/) · [Google Cloud](https://cloud.google.com/) · [Vercel](https://vercel.com/).

---

**Happy Coding! 🚀**
