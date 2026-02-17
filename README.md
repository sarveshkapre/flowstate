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
- v2 SaaS control-plane API foundations (projects/auth/flows/runs/datasets/review/edge)
- v2 Flow Builder UI (`/flow-builder`) with project members/API keys, graph authoring, version/deploy, and webhook test-run
- v2 Flow Builder replay controls (dataset versioning + baseline diff runs)
- v2 connector reliability foundation (idempotency keys, retry attempts, dead-letter records)
- v2 edge control channel foundation (agent config versions + command queue/ack flow)
- edge control UI (`/edge-control`) for agent registration, config, and command lifecycle operations
- security hardening baseline: secure response headers + payload size guards + secret-redacted storage for v2 control-plane writes
- global navigation command palette (`Cmd/Ctrl + K`) for fast page jumps
- richer operator UX on `/flow-builder` and `/edge-control` (action loading states, status banners, health badges, command filtering)

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
# set OPENAI_API_KEY in .env or export OPENAI_API_KEY in your shell
npm run setup:mac
npm start
# same as: npm run flowstate -- start
```

If `.env` is missing, `npm start` auto-creates it from `.env.example`.

To auto-ingest files dropped into `~/Flowstate/inbox`, set:

```bash
FLOWSTATE_ENABLE_FOLDER_WATCHER=1
FLOWSTATE_WATCH_WORKFLOW_ID=<workflow-id> # recommended
# or fallback:
# FLOWSTATE_WATCH_DOCUMENT_TYPE=invoice
```

Stop services:

```bash
npm stop
# same as: npm run flowstate -- stop
```

Check status and logs:

```bash
npm run flowstate -- status
npm run flowstate -- logs
npm run flowstate -- logs web
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
- Flow Builder v2 UI: http://localhost:3000/flow-builder
- Edge Adapter UI: http://localhost:3000/edge
- Edge Control UI: http://localhost:3000/edge-control
- Eval UI: http://localhost:3000/evals
- Organizations UI: http://localhost:3000/organizations

## Environment Variables

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (default: `gpt-4.1-mini`)
- `FLOWSTATE_ENV_PROFILE` (`local` | `staging` | `prod`, default: `local`)
- `FLOWSTATE_AUTH_MODE` (`optional` | `strict`, default: `optional`)
- `FLOWSTATE_MAGIC_LINK_EXPOSE_TOKEN` (default: `true` for local development)
- `FLOWSTATE_DATA_DIR` (optional override for storage directory)
- `FLOWSTATE_MAX_UPLOAD_BYTES` (default: `20971520`)
- `FLOWSTATE_EDGE_HEARTBEAT_STALE_MS` (default: `60000`)
- `FLOWSTATE_EDGE_COMMAND_LEASE_MS` (default: `30000`)
- `FLOWSTATE_DB_READ_CACHE_MS` (default: `250`)

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

## API Endpoints (v2 Foundations)

- `POST /api/v2/auth/magic-links/request`
- `POST /api/v2/auth/magic-links/verify`
- `GET /api/v2/projects`
- `POST /api/v2/projects`
- `GET /api/v2/projects/:projectId`
- `GET /api/v2/projects/:projectId/members`
- `POST /api/v2/projects/:projectId/members`
- `GET /api/v2/projects/:projectId/keys`
- `POST /api/v2/projects/:projectId/keys`
- `GET /api/v2/flows?projectId=...`
- `POST /api/v2/flows`
- `GET /api/v2/flows/:flowId/versions`
- `POST /api/v2/flows/:flowId/versions`
- `GET /api/v2/flows/:flowId/deploy`
- `POST /api/v2/flows/:flowId/deploy`
- `POST /api/v2/sources/webhook/:deploymentId`
- `GET /api/v2/runs?projectId=...`
- `GET /api/v2/runs/:runId`
- `GET /api/v2/runs/:runId/trace`
- `GET /api/v2/datasets?projectId=...`
- `POST /api/v2/datasets`
- `GET /api/v2/datasets/:datasetId/versions`
- `POST /api/v2/datasets/:datasetId/versions`
- `POST /api/v2/replay`
- `POST /api/v2/replay` supports optional `baselineFlowVersionId` and returns diff/accuracy summary
- `GET /api/v2/reviews/:queueId/decisions`
- `POST /api/v2/reviews/:queueId/decisions`
- `GET /api/v2/reviews/:queueId/evidence`
- `POST /api/v2/reviews/:queueId/evidence`
- `GET /api/v2/active-learning/candidates?projectId=...`
- `GET /api/v2/active-learning/eval-packs?projectId=...`
- `POST /api/v2/active-learning/eval-packs`
- `POST /api/v2/connectors/:type/test`
- `GET /api/v2/connectors/:type/deliver?projectId=...`
- `POST /api/v2/connectors/:type/deliver`
- `GET /api/v2/edge/agents?projectId=...`
- `POST /api/v2/edge/agents/register`
- `GET /api/v2/edge/agents/:agentId/config`
- `POST /api/v2/edge/agents/:agentId/config`
- `GET /api/v2/edge/agents/:agentId/commands`
- `POST /api/v2/edge/agents/:agentId/commands`
- `POST /api/v2/edge/agents/:agentId/commands/pull`
- `POST /api/v2/edge/agents/:agentId/commands/:commandId/ack`
- `GET /api/v2/edge/agents/:agentId/health`
- `POST /api/v2/edge/agents/:agentId/heartbeat`
- `GET /api/v2/edge/agents/:agentId/events`
- `POST /api/v2/edge/agents/:agentId/events`

## Commands

```bash
npm run setup:mac
npm start
npm stop
npm run flowstate -- status
npm run flowstate -- logs
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
