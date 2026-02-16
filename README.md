# Flowstate

Flowstate is an OpenAI-native VisionOps platform focused on extraction, validation, and human review workflows.

## Current Product Slice

Phase 1 wedge is implemented:
- upload image/PDF artifacts
- run invoice/receipt extraction with OpenAI Responses API
- validate extracted totals/required fields
- approve/reject in a review queue
- export approved jobs to CSV
- dispatch approved jobs to external webhook endpoints

Phase 2 foundations are now in progress:
- reviewer assignment action + audit event log
- dataset snapshot creation from reviewed jobs
- live operations metrics endpoint + dashboard cards
- workflow builder API/UI + workflow run history
- active learning candidate and snapshot endpoints
- drift insights endpoint (confidence trend + issue frequency)
- edge adapter bundle generation (Cloudflare Worker / Vercel Edge / Browser WASM)
- eval run API/UI for benchmark-style extraction quality tracking
- organization management + tenant scoping for workflow/edge/eval modules

## Core Principles

- OpenAI APIs only for model and agent capabilities
- Codex-first development workflow
- clean UX, fast interfaces, reproducible engineering

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- Turborepo + npm workspaces
- OpenAI Node SDK
- file-backed persistence in `.flowstate-data/` (artifact storage + job state)

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

## Mac Local Mode (Recommended)

For local single-operator deployments on macOS:

```bash
# set OPENAI_API_KEY in .env first
npm run setup:mac
npm run dev:up
```

To auto-ingest files dropped into `~/Flowstate/inbox`, set:

```bash
FLOWSTATE_ENABLE_FOLDER_WATCHER=1
FLOWSTATE_WATCH_WORKFLOW_ID=<workflow-id> # recommended
# or fallback:
# FLOWSTATE_WATCH_DOCUMENT_TYPE=invoice
```

Stop services:

```bash
npm run dev:down
```

Runtime artifacts:
- logs: `.flowstate-runtime/logs/`
- pids: `.flowstate-runtime/pids/`
- data: `.flowstate-data/` (or `FLOWSTATE_DATA_DIR`)
- inbox/archive/error dirs: `~/Flowstate/` (configurable via `FLOWSTATE_WATCH_*`)

Web app:
- http://localhost:3000
- Upload UI: http://localhost:3000/upload
- Review UI: http://localhost:3000/review
- Workflow UI: http://localhost:3000/workflows
- Edge Adapter UI: http://localhost:3000/edge
- Eval UI: http://localhost:3000/evals
- Organizations UI: http://localhost:3000/organizations

## Environment Variables

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (default: `gpt-4.1-mini`)
- `FLOWSTATE_DATA_DIR` (optional override for storage directory)
- `FLOWSTATE_MAX_UPLOAD_BYTES` (default: `20971520`)

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

## API Endpoints (v1)

- `GET /api/health`
- `POST /api/v1/uploads`
- `GET /api/v1/uploads/:artifactId/file`
- `GET /api/v1/extractions`
- `POST /api/v1/extractions`
- `GET /api/v1/extractions/:jobId`
- `PATCH /api/v1/extractions/:jobId` (assign reviewer or review approve/reject)
- `GET /api/v1/exports/csv`
- `POST /api/v1/exports/webhook`
- `GET /api/v1/metrics`
- `GET /api/v1/drift`
- `GET /api/v1/edge/adapters`
- `GET /api/v1/edge/bundles`
- `POST /api/v1/edge/bundles`
- `GET /api/v1/edge/bundles/:bundleId/download`
- `GET /api/v1/evals/runs`
- `POST /api/v1/evals/runs`
- `GET /api/v1/organizations`
- `POST /api/v1/organizations`
- `GET /api/v1/audit-events`
- `GET /api/v1/datasets/snapshots`
- `POST /api/v1/datasets/snapshots`
- `GET /api/v1/workflows`
- `POST /api/v1/workflows`
- `GET /api/v1/workflows/:workflowId/runs`
- `POST /api/v1/workflows/:workflowId/runs`
- `GET /api/v1/active-learning/candidates`
- `POST /api/v1/active-learning/snapshots`

## Commands

```bash
npm run setup:mac
npm run dev:up
npm run dev:down
npm run watch:inbox
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run format:write
```

## Public Repository

- GitHub: [sarveshkapre/flowstate](https://github.com/sarveshkapre/flowstate)
