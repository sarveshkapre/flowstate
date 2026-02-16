# Flowstate

Flowstate is an OpenAI-native VisionOps platform in progress.

This repository is a production-grade monorepo scaffold for building:
- a modern web app (`apps/web`)
- a background worker service (`apps/worker`)
- shared packages (`packages/ui`, `packages/types`)

## Core Principles

- OpenAI APIs only for model and agent capabilities
- Codex-first development workflow
- clean UX, fast interfaces, reproducible engineering

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS v4
- Turborepo + npm workspaces
- OpenAI Node SDK

## Quick Start

```bash
npm install
npm run dev
```

Web app:
- http://localhost:3000

## Workspace Layout

```text
apps/
  web/        # Next.js frontend + API routes
  worker/     # background jobs + async pipelines
packages/
  ui/         # shared UI components
  types/      # shared schema/types
docs/         # architecture notes
```

## Initial API Endpoints

- `GET /api/health`
- `POST /api/v1/extract` (OpenAI-powered extraction starter)

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run format:write
```

## Public Repository Checklist

- [x] MIT license
- [x] clean `.gitignore`
- [x] documented setup
- [ ] create GitHub public repo and push

