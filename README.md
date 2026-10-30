<p align="center">
  <a href="https://github.com/thanks2music/revolution">
    <img src="apps/frontend/public/images/og-image-compressed.png" width="100%" alt="Revolution">
  </a>
</p>

# Revolution

> **Languages**: [🇬🇧 English](README.md) | [🇯🇵 日本語](README.ja.md)

![License](https://img.shields.io/badge/license-Personal%20Project-blue)
![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-12-f69220?logo=pnpm&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-2-ef4444?logo=turborepo&logoColor=white)

A next-generation Jamstack web media platform with an LLM-powered AI article generation pipeline. A personal project by [@thanks2music](https://github.com/thanks2music) — a playground for modern web application architecture.

## What is Revolution?

Built on the experience of manually creating over 10,000 articles, Revolution distills that practical knowledge into LLMs and modular YAML templates. The AI Writer turns an RSS feed or a URL into an MDX article and opens a GitHub pull request; once the pull request is merged, Vercel builds and publishes the site.

- **Articles** are MDX files in this repository (no database for articles), served with Next.js static site generation (SSG) and ISR
- **Structured data and member features** (accounts, favorites) live in Supabase (Postgres + Auth)
- **Prompts and templates** live in a separate private repository

## Documentation

> Most detailed docs are written in Japanese.

| Topic | Link |
|---|---|
| Full document index + navigation | [`docs/README.md`](./docs/README.md) |
| Project overview & architecture | [`docs/overview.md`](./docs/overview.md) |
| Current tech stack | [`docs/current-stack.md`](./docs/current-stack.md) |
| AI Writer MDX pipeline (overview) | [`apps/ai-writer/README.md`](./apps/ai-writer/README.md) |
| Monorepo (pnpm + Turborepo) | [`docs/monorepo.md`](./docs/monorepo.md) |
| Development & build commands | [`docs/build.md`](./docs/build.md) |
| AI Writer Cloud Run deploy | [`docs/ai-writer-cloud-run.md`](./docs/ai-writer-cloud-run.md) |

The documents directly under `docs/` are also published as a documentation site built from `apps/docs` (not indexed by search engines).

## Quick Start

Prerequisites: Node.js 24 (pinned in [`.tool-versions`](./.tool-versions)) and pnpm 12 (pinned in the `packageManager` field of [`package.json`](./package.json)).

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
pnpm dev:docs                 # Documentation site only (http://localhost:3333)
```

> 💡 If you run multiple worktrees in parallel, use `bash scripts/worktree-dev.sh frontend` / `bash scripts/worktree-dev.sh ai-writer` / `bash scripts/worktree-dev.sh docs` to avoid port collisions. `pnpm dev` always uses the default ports (4444 / 7777).

Generating articles also needs LLM API keys and the templates from the private repository (copied in with `pnpm sync:templates`), so the pipeline does not run end to end from a fresh clone.

See [`docs/build.md`](./docs/build.md) for the full command reference.

## Tech Stack

- **Frontend**: Next.js 16 / React 19 / TypeScript 5 / Tailwind CSS / SWR / next-mdx-remote, on Vercel (SSG + ISR)
- **Data & Auth**: Supabase (Postgres + Auth) / Drizzle ORM / Zod schemas shared in `shared/schemas`
- **AI Writer**: Next.js 16 on Google Cloud Run / Claude (Anthropic) · Gemini (Google) · OpenAI, switchable via env vars / Firebase (Auth + Firestore) for the admin UI and pipeline state
- **Storage**: Cloudflare R2 (article images)
- **Docs site**: Next.js 16 / Fumadocs, on Vercel
- **Observability**: Sentry / Slack notifications
- **Tooling**: pnpm 12 / Turborepo 2 / Jest 30 / Playwright / ESLint 9 / Prettier 3 / Husky 9

For the detailed table see [`docs/current-stack.md`](./docs/current-stack.md).

## Development tooling

### Git hooks (Husky)

- **pre-commit**: scans the staged files for secrets with [gitleaks](https://github.com/gitleaks/gitleaks) (skipped with a notice when gitleaks is not installed)
- **pre-push**: runs the Jest tests related to the changed TS/TSX/JS files in `apps/ai-writer` (about 30–60 seconds)
- To skip in an emergency: `HUSKY=0 git push`. Otherwise fix the failing tests and push again; the gate is there to stop silent failures

The hook scripts live in [`.husky/`](./.husky/).

## Project Structure

```text
revolution/
├── apps/
│   ├── ai-writer/       # AI article generation pipeline + admin UI (Next.js 16, Cloud Run)
│   ├── docs/            # Documentation site (Next.js 16 / Fumadocs)
│   ├── frontend/        # Public web site (Next.js 16, Vercel) + Supabase migrations
│   └── mcp-gcp-server/  # Model Context Protocol server
├── docs/                # Public documentation
├── shared/
│   └── schemas/         # Zod schemas and Drizzle table definitions (workspace-wide)
├── scripts/             # Automation scripts
└── .github/workflows/   # CI/CD pipelines
```

## Acknowledgments

Built with [Next.js](https://nextjs.org/) · [Anthropic Claude](https://www.anthropic.com/) · [Supabase](https://supabase.com/) · [Vercel](https://vercel.com/) · [Google Cloud](https://cloud.google.com/) · [Firebase](https://firebase.google.com/).

---

**Happy Coding! 🚀**
